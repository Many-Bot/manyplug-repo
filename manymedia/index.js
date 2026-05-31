/**
 * plugins/manymedia/index.js
 *
 * Downloads video or audio via yt-dlp (or instaloader for Instagram)
 * and uploads/sends to server. Handles /video and /audio commands.
 */

import { execFile, spawn }  from "child_process";
import { promisify }        from "util";
import fs                   from "fs";
import path                 from "path";
import { enqueue }          from "../../download/queue.js";
import { CMD_PREFIX, CONFIG } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const execFileAsync = promisify(execFile);
const {
  UPL_MEDIA_TO_SRV    = "no",
  MEDIA_SRV_API_KEY,
  INSTALOADER_PATH    = "instaloader",   // absolute path or command name on PATH
  INSTALOADER_USER,                      // Instagram username whose session to load
  INSTALOADER_SESSION_FILE,              // absolute path to the instaloader session file
} = CONFIG;
const { t } = createPluginI18n(import.meta.url);

fs.mkdirSync("logs", { recursive: true });
const logStream = fs.createWriteStream("logs/video-error.log", { flags: "a" });
logStream.on("error", err => console.error("[logStream]", err));

const DOWNLOADS_DIR = path.resolve("downloads");
const UPLOAD_URL    = "https://api.stxerr.dev/upload";

// ─── URL Resolvers ────────────────────────────────────────────────────────────

async function resolveRedditUrl(url) {
  if (!url.includes("reddit.com") && !url.includes("redd.it")) return url;

  console.log(`[video] Reddit URL detected, resolving via yt-dlp --get-url`);

  const { stdout } = await execFileAsync("yt-dlp", [
    "--get-url",
    "--no-playlist",
    "--cookies", "cookies.txt",
    url,
  ]);

  // --get-url returns one URL per line; grab the first v.redd.it one (video stream)
  const videoUrl = stdout.trim().split("\n").find(l => l.includes("v.redd.it"));
  if (!videoUrl) throw new Error("yt-dlp could not extract a v.redd.it URL from this Reddit post.");

  console.log(`[video] Resolved Reddit URL: ${videoUrl}`);
  return videoUrl;
}

async function resolveUrl(url) {
  return resolveRedditUrl(url);
}

// ─── Downloaders ──────────────────────────────────────────────────────────────

async function downloadInstagram(url) {
  if (!INSTALOADER_USER)         throw new Error("INSTALOADER_USER is not set in config.");
  if (!INSTALOADER_SESSION_FILE) throw new Error("INSTALOADER_SESSION_FILE is not set in config.");

  const match = url.match(/instagram\.com\/(?:reel|p|tv)\/([^/?#]+)/);
  if (!match) throw new Error("Invalid Instagram URL.");

  const shortcode = match[1];
  const targetDir = path.join(DOWNLOADS_DIR, shortcode);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });

  console.log(`[video] instaloader binary: ${INSTALOADER_PATH}`);
  console.log(`[video] Instagram session user: ${INSTALOADER_USER}`);
  console.log(`[video] Instagram shortcode: ${shortcode} -> ${targetDir}`);

  console.log(`[video] instaloader session file: ${INSTALOADER_SESSION_FILE}`);

  // --sessionfile pins the exact session path so it works regardless of which
  // user (or systemd unit) runs the process — avoids the interactive password prompt.
  await execFileAsync(INSTALOADER_PATH, [
    `--login=${INSTALOADER_USER}`,
    `--sessionfile=${INSTALOADER_SESSION_FILE}`,
    `--dirname-pattern=${targetDir}`,
    "--no-metadata-json",
    "--no-captions",
    "--",
    `-${shortcode}`,
  ], { timeout: 60_000 }); // 60s hard timeout — prevents freezing if session is invalid

  const files = await fs.promises.readdir(targetDir);
  const mp4   = files.find(f => f.endsWith(".mp4"));
  if (!mp4) throw new Error(`MP4 not found in ${targetDir}. Files present: ${files.join(", ") || "(none)"}`);

  return { filePath: path.resolve(targetDir, mp4), tmpDir: targetDir };
}

function buildYtDlpArgs(url, format) {
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
  const isMp3     = format === "mp3";

  const args = [
    "--print",            "after_move:filepath",
    "--cookies",          "cookies.txt",
    "--add-header",       "User-Agent:Mozilla/5.0",
    "--retries",          "4",
    "--fragment-retries", "5",
    "--socket-timeout",   "15",
    "--sleep-interval",   "1",
    "--max-sleep-interval","4",
    "--no-playlist",
  ];

  if (isMp3) {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    args.push("-f", "bv+ba/best");
  }

  if (isYouTube) {
    args.push(
      "--extractor-args", "youtube:player_client=android",
      "--add-header",     "Referer:https://www.youtube.com/",
    );
  }

  return args;
}

async function downloadYtDlp(url, id, format) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(DOWNLOADS_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const args = [
      ...buildYtDlpArgs(url, format),
      "--output", path.join(tmpDir, "%(title).80s.%(ext)s"),
      url,
    ];

    console.log(`[video] Downloading (${format}): ${url}`);
    console.log(`[video] yt-dlp args: ${args.join(" ")}`);

    const proc = spawn("yt-dlp", args);
    let stdout = "", stderr = "";

    proc.on("error", err => {
      const msg = err.code === "EACCES" ? t("error.noPermission")
        : err.code === "ENOENT"         ? t("error.notFound")
        :                                 `${t("error.startError")} ${err.message}`;
      reject(new Error(msg));
    });

    proc.stdout.on("data", d => { const s = d.toString(); stdout += s; console.log(`[video] ${s.trim()}`); });
    proc.stderr.on("data", d => { const s = d.toString(); stderr += s; logStream.write(s); console.error(`[video] ${s.trim()}`); });

    proc.on("close", code => {
      console.log(`[video] yt-dlp exited with code ${code}`);
      if (code !== 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.error(`[video] Last stderr:\n${stderr.split("\n").slice(-5).join("\n")}`);
        return reject(new Error(`${t("error.downloadFailed")} (exit code ${code})`));
      }

      let filePath = stdout.trim().split("\n").filter(Boolean).at(-1);
      if (!filePath || !fs.existsSync(filePath)) {
        const files = fs.readdirSync(tmpDir).filter(f => !f.endsWith(".part"));
        filePath = files.length === 1 ? path.join(tmpDir, files[0]) : null;
      }

      if (!filePath) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return reject(new Error(t("error.fileNotFound")));
      }

      console.log(`[video] Downloaded to: ${filePath}`);
      resolve({ filePath, tmpDir });
    });
  });
}

async function downloadMedia(url, id, format) {
  url = await resolveUrl(url);

  const isInstagram = url.includes("instagram.com");
  if (isInstagram) return downloadInstagram(url);

  return downloadYtDlp(url, id, format);
}

// ─── Upload ───────────────────────────────────────────────────────────────────

const UPLOAD_RETRIES        = 4;
const UPLOAD_RETRY_DELAY_MS = 3000;

async function uploadToServer(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName   = path.basename(filePath);
  console.log(`[video] Uploading: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  let lastError;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`[video] Retrying upload (attempt ${attempt}/${UPLOAD_RETRIES})...`);
      await new Promise(res => setTimeout(res, UPLOAD_RETRY_DELAY_MS));
    }
    try {
      const body = new FormData();
      body.append("file", new Blob([fileBuffer]), fileName);

      const res  = await fetch(UPLOAD_URL, { method: "POST", headers: { "x-api-key": MEDIA_SRV_API_KEY }, body });
      const text = await res.text();
      console.log(`[video] Upload response: ${res.status} ${res.statusText}`);

      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);

      const result = JSON.parse(text);
      if (!result.url) throw new Error("Server response missing url");

      const finalUrl = result.url.startsWith("https") ? result.url : `https://api.stxerr.dev${result.url}`;
      console.log(`[video] Upload complete: ${finalUrl}`);
      return finalUrl;

    } catch (err) {
      lastError = err;
      console.error(`[video] Upload attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw new Error(`Upload failed after ${UPLOAD_RETRIES} attempts: ${lastError.message}`);
}

// ─── Queue Handler ────────────────────────────────────────────────────────────

function handleMedia(url, format, cmd, { msg, api }) {
  const id       = `${format}-${Date.now()}`;
  const sendFile  = (p) => format === "mp3" ? api.sendAudio(p) : api.sendVideo(p);

  enqueue(
    async () => {
      const { filePath, tmpDir } = await downloadMedia(url, id, format);
      try {
        if (UPL_MEDIA_TO_SRV === "yes") {
          const link = await uploadToServer(filePath);
          await msg.reply(`*Download:*\n${link}`);
        } else {
          await sendFile(filePath);
        }
        api.log.info(`${cmd} completed → ${url}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    async () => msg.reply(t("error.generic"))
  );
}

// ─── Command Entry Point ──────────────────────────────────────────────────────

export default async function ({ msg, api }) {
  const commands = {
    [CMD_PREFIX + "video"]: "mp4",
    [CMD_PREFIX + "audio"]: "mp3",
  };

  for (const [cmd, format] of Object.entries(commands)) {
    if (!msg.is(cmd)) continue;

    const url = msg.args[1];
    if (!url) {
      await msg.reply(`${t("noUrl")} \`${cmd} https://example.com/...\``);
      return;
    }

    await msg.reply(t("downloading"));
    handleMedia(url, format, cmd, { msg, api });
    return;
  }
}

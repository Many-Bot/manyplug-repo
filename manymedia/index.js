/**
 * plugins/manymedia/index.js
 *
 * Downloads video or audio via yt-dlp
 * and uploads/sends to server. Handles /video and /audio commands.
 */

import { execFile, spawn } from "child_process";
import { promisify }       from "util";
import fs                  from "fs";
import path                from "path";

const execFileAsync = promisify(execFile);

fs.mkdirSync("logs", { recursive: true });
const logStream = fs.createWriteStream("logs/video-error.log", { flags: "a" });
logStream.on("error", err => console.error("[logStream]", err));

const DOWNLOADS_DIR = path.resolve("downloads");
const UPLOAD_URL    = "https://api.stxerr.dev/upload";


// Resolve Reddit URL

async function resolveRedditUrl(url) {
  if (!url.includes("reddit.com") && !url.includes("redd.it")) return { url, audioUrl: null };

  const { stdout } = await execFileAsync("yt-dlp", [
    "--get-url",
    "--no-playlist",
    "--cookies", "cookies.txt",
    url,
  ]);

  const lines     = stdout.trim().split("\n").filter(Boolean);
  const videoUrl  = lines.find(l => !l.includes("AUDIO")) ?? lines[0];
  const audioUrl  = lines.find(l => l.includes("AUDIO")) ?? null;

  return { url: videoUrl, audioUrl };
}


// ─── Downloaders ──────────────────────────────────────────────────────────────

function buildYtDlpArgs(url, format) {
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
  const isMp3     = format === "mp3";

  const args = [
    "--print",             "after_move:filepath",
    "--cookies",           "cookies.txt",
    "--add-header",        "User-Agent:Mozilla/5.0",
    "--retries",           "4",
    "--fragment-retries",  "5",
    "--socket-timeout",    "15",
    "--sleep-interval",    "1",
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

async function downloadYtDlp(url, id, format, t) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(DOWNLOADS_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const args = [
      ...buildYtDlpArgs(url, format),
      "--output", path.join(tmpDir, "%(title).80s.%(ext)s"),
      url,
    ];

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

      resolve({ filePath, tmpDir });
    });
  });
}

async function downloadRedditWithAudio(videoUrl, audioUrl, id, format) {
  const tmpDir   = path.join(DOWNLOADS_DIR, id);
  fs.mkdirSync(tmpDir, { recursive: true });

  const isMp3    = format === "mp3";
  const filePath = isMp3
    ? path.join(tmpDir, "audio.mp3")
    : path.join(tmpDir, "video.mp4");

  const args = isMp3
    ? ["-i", audioUrl, "-shortest", filePath]
    : ["-i", videoUrl, "-i", audioUrl, "-c:v", "copy", "-c:a", "aac", "-shortest", filePath];

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    proc.stderr.on("data", d => logStream.write(d));
    proc.on("error", reject);
    proc.on("close", code => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}`));
      resolve();
    });
  });

  return { filePath, tmpDir };
}

async function downloadMedia(url, id, format, t) {
  const { url: resolvedUrl, audioUrl } = await resolveRedditUrl(url);

  if (audioUrl) {
    return downloadRedditWithAudio(resolvedUrl, audioUrl, id, format);
  }

  return downloadYtDlp(resolvedUrl, id, format, t);
}

// ─── Upload ───────────────────────────────────────────────────────────────────

const UPLOAD_RETRIES        = 4;
const UPLOAD_RETRY_DELAY_MS = 3000;

async function uploadToServer(filePath, apiKey) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName   = path.basename(filePath);

  let lastError;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`[video] Retrying upload (attempt ${attempt}/${UPLOAD_RETRIES})...`);
      await new Promise(res => setTimeout(res, UPLOAD_RETRY_DELAY_MS));
    }
    try {
      const body = new FormData();
      body.append("file", new Blob([fileBuffer]), fileName);

      const res    = await fetch(UPLOAD_URL, { method: "POST", headers: { "x-api-key": apiKey }, body });
      const text   = await res.text();
      console.log(`[video] Upload response: ${res.status} ${res.statusText}`);

      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);

      const result = JSON.parse(text);
      if (!result.url) throw new Error("Server response missing url");

      const finalUrl = result.url.startsWith("https")
        ? result.url
        : `https://api.stxerr.dev${result.url}`;
      return finalUrl;

    } catch (err) {
      lastError = err;
      console.error(`[video] Upload attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw new Error(`Upload failed after ${UPLOAD_RETRIES} attempts: ${lastError.message}`);
}

// ─── Queue Handler ────────────────────────────────────────────────────────────

function handleMedia(url, format, cmd, ctx, t) {
  const { msg }      = ctx;
  const uplToSrv     = ctx.config.get("UPL_MEDIA_TO_SRV", "no");
  const srvApiKey    = ctx.config.get("MEDIA_SRV_API_KEY");
  const id           = `${format}-${Date.now()}`;
  const sendFile     = (p) => format === "mp3" ? ctx.sendAudio(p) : ctx.sendVideo(p);

  ctx.download.enqueue(
    async () => {
      const { filePath, tmpDir } = await downloadMedia(url, id, format, t);
      try {
        if (uplToSrv === "yes") {
          const link = await uploadToServer(filePath, srvApiKey);
          await msg.reply(`*Download:*\n${link}`);
        } else {
          await sendFile(filePath);
        }
        ctx.log.info(`${cmd} completed → ${url}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    async () => msg.reply(t("error.generic"))
  );
}

// ─── Command Entry Point ──────────────────────────────────────────────────────

export default async function (ctx) {
  const { msg }  = ctx;
  const prefix   = ctx.config.get("CMD_PREFIX");
  const { t }    = ctx.i18n.createT(import.meta.url);

  const commands = {
    [prefix + "video"]: "mp4",
    [prefix + "audio"]: "mp3",
  };

  for (const [cmd, format] of Object.entries(commands)) {
    if (!msg.is(cmd)) continue;

    const url = msg.args[1];
    if (!url) {
      await msg.reply(`${t("noUrl")} \`${cmd} https://example.com/...\``);
      return;
    }

    await msg.reply(t("downloading"));
    handleMedia(url, format, cmd, ctx, t);
    return;
  }
}

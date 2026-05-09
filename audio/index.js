/**
 * plugins/audio/index.js
 *
 * Downloads audio via yt-dlp, converts to mp3 via ffmpeg and uploads to server.
 * All processing (download + conversion + upload + cleanup) is here.
 */

import { spawn }       from "child_process";
import { execFile }    from "child_process";
import { promisify }   from "util";
import fs              from "fs";
import path            from "path";
import { enqueue }     from "../../download/queue.js";
import { CMD_PREFIX }  from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

fs.mkdirSync("logs", { recursive: true });
const logStream = fs.createWriteStream("logs/audio-error.log", { flags: "a" });
logStream.on("error", err => console.error("[logStream]", err));

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP = "yt-dlp";
const FFMPEG = "ffmpeg";
const UPLOAD_URL = "https://api.stxerr.dev/upload";

const execFileAsync = promisify(execFile);

function getArgsForUrl(url) {
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
  const args = [
    "--print",              "after_move:filepath",
    "--cookies",            "cookies.txt",
    "--add-header",         "User-Agent:Mozilla/5.0",
    "--retries",            "4",
    "--fragment-retries",   "5",
    "--socket-timeout",     "15",
    "--sleep-interval",     "1",
    "--max-sleep-interval", "4",
    "--no-playlist",
    "-f", "bv+ba/best",
  ];

  // YouTube-specific args (can cause issues on other sites)
  if (isYouTube) {
    args.push(
      "--extractor-args", "youtube:player_client=android",
      "--add-header",     "Referer:https://www.youtube.com/",
    );
  }

  return args;
}

function downloadRaw(url, id) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(DOWNLOADS_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const output = path.join(tmpDir, "%(title).80s.%(ext)s");
    const args = getArgsForUrl(url);
    const proc = spawn(YT_DLP, [...args, "--output", output, url]);
    let stdout = "";
    let stderr = "";

    console.log(`[audio] Downloading: ${url}`);
    console.log(`[audio] yt-dlp args: ${args.join(" ")}`);

    proc.on("error", err => {
      const msg = err.code === "EACCES" ? t("error.noPermission")
        : err.code === "ENOENT" ? t("error.notFound")
        : `${t("error.startError")} ${err.message}`;
      console.error(`[audio] Spawn error: ${err.message}`);
      reject(new Error(msg));
    });

    proc.stdout.on("data", d => {
      const text = d.toString();
      stdout += text;
      console.log(`[audio] ${text.trim()}`);
    });

    proc.stderr.on("data", d => {
      const text = d.toString();
      stderr += text;
      logStream.write(text);
      console.error(`[audio] ${text.trim()}`);
    });

    proc.on("close", code => {
      console.log(`[audio] yt-dlp exited with code ${code}`);

      if (code !== 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        const lastStderr = stderr.split("\n").slice(-5).join("\n");
        console.error(`[audio] Download failed. Last stderr:\n${lastStderr}`);
        return reject(new Error(`${t("error.downloadFailed")} (exit code ${code})`));
      }

      let filePath = stdout.trim().split("\n").filter(Boolean).at(-1);

      if (!filePath || !fs.existsSync(filePath)) {
        const files = fs.readdirSync(tmpDir).filter(f => !f.endsWith(".part"));
        filePath = files.length === 1 ? path.join(tmpDir, files[0]) : null;
      }

      if (!filePath) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.error(`[audio] File not found. stdout was:\n${stdout}`);
        return reject(new Error(t("error.fileNotFound")));
      }

      console.log(`[audio] Downloaded to: ${filePath}`);
      resolve({ filePath, tmpDir });
    });
  });
}

async function convertToMp3(videoPath, id) {
  const tmpDir = path.join(DOWNLOADS_DIR, id);
  const mp3Path = path.join(tmpDir, `${id}.mp3`);

  console.log(`[audio] Converting to MP3: ${videoPath}`);

  try {
    const { stdout, stderr } = await execFileAsync(FFMPEG, [
      "-i", videoPath,
      "-vn",          // no video
      "-ar", "44100", // sample rate
      "-ac", "2",     // stereo
      "-b:a", "192k", // bitrate
      "-y",           // overwrite if exists
      mp3Path,
    ]);
    console.log(`[audio] ffmpeg stdout: ${stdout}`);
    if (stderr) console.log(`[audio] ffmpeg stderr: ${stderr}`);
  } catch (err) {
    console.error(`[audio] ffmpeg error: ${err.message}`);
    throw err;
  }

  fs.unlinkSync(videoPath);
  console.log(`[audio] Converted to: ${mp3Path}`);
  return mp3Path;
}

async function uploadToServer(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  console.log(`[audio] Uploading: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    body: formData,
  });

  const responseText = await response.text();
  console.log(`[audio] Upload response: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    console.error(`[audio] Upload failed: ${response.status} - ${responseText}`);
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (err) {
    console.error(`[audio] Failed to parse upload response: ${responseText}`);
    throw new Error(`Server response not JSON: ${responseText.slice(0, 200)}`);
  }

  if (!result.url) {
    console.error(`[audio] Server response missing url: ${JSON.stringify(result)}`);
    throw new Error("Server response missing url");
  }

  const finalUrl = result.url.startsWith("https") ? result.url : `https://api.stxerr.dev${result.url}`;
  console.log(`[audio] Upload complete: ${finalUrl}`);
  return finalUrl;
}

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "audio")) return;

  const url = msg.args[1];

  if (!url) {
    await msg.reply(`${t("noUrl")} \`${CMD_PREFIX}audio https://youtube.com/...\``);
    return;
  }

  await msg.reply(t("downloading"));

  const id = `audio-${Date.now()}`;

  enqueue(
    async () => {
      try {
        const { filePath, tmpDir } = await downloadRaw(url, id);
        const mp3Path = await convertToMp3(filePath, id);
        const downloadUrl = await uploadToServer(mp3Path);
        await msg.reply(downloadUrl);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        api.log.info(`${CMD_PREFIX}audio completed → ${url}`);
      } catch (err) {
        console.error(`[audio] Task error: ${err.message}`);
        await msg.reply(`${t("error.generic")}\n\`${err.message}\``);
        throw err;
      }
    },
    async () => {
      await msg.reply(t("error.generic"));
    }
  );
}

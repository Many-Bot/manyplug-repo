/**
 * plugins/video/index.js
 *
 * Downloads video via yt-dlp and uploads to server.
 * All processing (download + upload + cleanup) is here.
 */

import { spawn }       from "child_process";
import fs              from "fs";
import path            from "path";
import { enqueue }     from "../../download/queue.js";
import { CMD_PREFIX }  from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

fs.mkdirSync("logs", { recursive: true });
const logStream = fs.createWriteStream("logs/video-error.log", { flags: "a" });
logStream.on("error", err => console.error("[logStream]", err));

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP = "yt-dlp";
const UPLOAD_URL = "https://maneos.net/upload";

const ARGS_BASE = [
  "--extractor-args",     "youtube:player_client=android",
  "--print",              "after_move:filepath",
  "--cookies",            "cookies.txt",
  "--add-header",         "User-Agent:Mozilla/5.0",
  "--add-header",         "Referer:https://www.youtube.com/",
  "--retries",            "4",
  "--fragment-retries",   "5",
  "--socket-timeout",     "15",
  "--sleep-interval",     "1",
  "--max-sleep-interval", "4",
  "--no-playlist",
  "-f", "bv+ba/best",
];

function downloadVideo(url, id) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(DOWNLOADS_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const output = path.join(tmpDir, "%(title).80s.%(ext)s");
    const proc   = spawn(YT_DLP, [...ARGS_BASE, "--output", output, url]);
    let stdout   = "";

    proc.on("error", err => reject(new Error(
      err.code === "EACCES" ? t("error.noPermission")
      : err.code === "ENOENT" ? t("error.notFound")
      : `${t("error.startError")} ${err.message}`
    )));

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => logStream.write(d));

    proc.on("close", code => {
      if (code !== 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return reject(new Error(t("error.downloadFailed")));
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

async function uploadToServer(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.url) {
    throw new Error("Server response missing url");
  }

  return result.url.startsWith("https") ? result.url : `https://maneos.net${result.url}`;
}

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "video")) return;

  const url = msg.args[1];

  if (!url) {
    await msg.reply(`${t("noUrl")} \`${CMD_PREFIX}video https://youtube.com/...\``);
    return;
  }

  await msg.reply(t("downloading"));

  const id = `video-${Date.now()}`;

  enqueue(
    async () => {
      const { filePath, tmpDir } = await downloadVideo(url, id);
      const downloadUrl = await uploadToServer(filePath);
      await msg.reply(downloadUrl);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      api.log.info(`${CMD_PREFIX}video completed → ${url}`);
    },
    async () => {
      await msg.reply(t("error.generic"));
    }
  );
}

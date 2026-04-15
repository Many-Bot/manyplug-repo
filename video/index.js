/**
 * plugins/video/index.js
 *
 * Downloads video via yt-dlp and sends to chat.
 * All processing (download + send + cleanup) is here.
 */

import { spawn }       from "child_process";
import fs              from "fs";
import path            from "path";
import os              from "os";
import { enqueue }     from "../../download/queue.js";
import { CMD_PREFIX }  from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

fs.mkdirSync("logs", { recursive: true });
const logStream = fs.createWriteStream("logs/video-error.log", { flags: "a" });
logStream.on("error", err => console.error("[logStream]", err));

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP = os.platform() === "win32" ? ".\\bin\\yt-dlp.exe" : "./bin/yt-dlp";

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
    // Isolated folder just for this download
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

      // Try stdout path first
      let filePath = stdout.trim().split("\n").filter(Boolean).at(-1);

      // Fallback: get the single file inside the isolated folder
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
      await api.sendVideo(filePath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      api.log.info(`${CMD_PREFIX}video completed → ${url}`);
    },
    async () => {
      await msg.reply(t("error.generic"));
    }
  );
}
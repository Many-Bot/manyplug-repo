/**
 * plugins/manymedia/index.js
 *
 * Downloads video or audio via yt-dlp and uploads to server.
 * Handles both /video (mp4) and /audio (mp3) commands.
 */

import { spawn }      from "child_process";
import fs             from "fs";
import path           from "path";
import { enqueue }    from "../../download/queue.js";
import { CMD_PREFIX, CONFIG } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { UPL_MEDIA_TO_SRV = "no", MEDIA_SRV_API_KEY } = CONFIG;

const { t } = createPluginI18n(import.meta.url);

fs.mkdirSync("logs", { recursive: true });
const logStream = fs.createWriteStream("logs/video-error.log", { flags: "a" });
logStream.on("error", err => console.error("[logStream]", err));

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP = "yt-dlp";
const UPLOAD_URL = "https://api.stxerr.dev/upload";

/**
 * If the URL is a Reddit post, uses Reddit's public JSON API to extract
 * the v.redd.it video URL directly from the post data — avoids 403s from
 * scraping the HTML page.
 * Returns the resolved URL, or the original URL unchanged for non-Reddit links.
 */
async function resolveRedditUrl(url) {
  const isReddit = url.includes("reddit.com") || url.includes("redd.it");
  if (!isReddit) return url;

  console.log(`[video] Reddit URL detected, resolving via JSON API: ${url}`);

  // Normalise: strip trailing slash, then append .json
  const jsonUrl = url.replace(/\/$/, "") + ".json";

  const res = await fetch(jsonUrl, {
    headers: {
      // Reddit requires a descriptive User-Agent for API access
      "User-Agent": "bot:video-downloader-plugin:1.0 (by /u/anonymous)",
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Reddit JSON API error: ${res.status} ${res.statusText}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("Reddit returned non-JSON response");
  }

  // Reddit JSON structure: [listing, comments] — post is in listing.data.children[0].data
  const post = json?.[0]?.data?.children?.[0]?.data;

  if (!post) {
    throw new Error("Could not parse Reddit post data from JSON response");
  }

  // reddit_video is present when the post hosts a native v.redd.it video
  const videoUrl = post?.secure_media?.reddit_video?.hls_url
    ?? post?.media?.reddit_video?.hls_url;

  if (!videoUrl) {
    throw new Error(t("error.redditVideoNotFound") ?? "No v.redd.it video found in this Reddit post.");
  }

  // The JSON API can still return HTML-encoded ampersands in the HLS query string
  const cleanUrl = videoUrl.replace(/&amp;/g, "&");
  console.log(`[video] Resolved Reddit video URL: ${cleanUrl}`);
  return cleanUrl;
}

function getArgsForUrl(url, format) {
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
  const isMp3 = format === "mp3";

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
  ];

  if (isMp3) {
    args.push(
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
    );
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

async function downloadMedia(url, id, format) {
  url = await resolveRedditUrl(url);

  return new Promise((resolve, reject) => {
    const tmpDir = path.join(DOWNLOADS_DIR, id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const output = path.join(tmpDir, "%(title).80s.%(ext)s");
    const args = getArgsForUrl(url, format);
    const proc = spawn(YT_DLP, [...args, "--output", output, url]);
    let stdout = "";
    let stderr = "";

    console.log(`[video] Downloading (${format}): ${url}`);
    console.log(`[video] yt-dlp args: ${args.join(" ")}`);

    proc.on("error", err => {
      const msg = err.code === "EACCES" ? t("error.noPermission")
        : err.code === "ENOENT" ? t("error.notFound")
        : `${t("error.startError")} ${err.message}`;
      console.error(`[video] Spawn error: ${err.message}`);
      reject(new Error(msg));
    });

    proc.stdout.on("data", d => {
      const text = d.toString();
      stdout += text;
      console.log(`[video] ${text.trim()}`);
    });

    proc.stderr.on("data", d => {
      const text = d.toString();
      stderr += text;
      logStream.write(text);
      console.error(`[video] ${text.trim()}`);
    });

    proc.on("close", code => {
      console.log(`[video] yt-dlp exited with code ${code}`);

      if (code !== 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        const lastStderr = stderr.split("\n").slice(-5).join("\n");
        console.error(`[video] Download failed. Last stderr:\n${lastStderr}`);
        return reject(new Error(`${t("error.downloadFailed")} (exit code ${code})`));
      }

      let filePath = stdout.trim().split("\n").filter(Boolean).at(-1);

      if (!filePath || !fs.existsSync(filePath)) {
        const files = fs.readdirSync(tmpDir).filter(f => !f.endsWith(".part"));
        filePath = files.length === 1 ? path.join(tmpDir, files[0]) : null;
      }

      if (!filePath) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.error(`[video] File not found. stdout was:\n${stdout}`);
        return reject(new Error(t("error.fileNotFound")));
      }

      console.log(`[video] Downloaded to: ${filePath}`);
      resolve({ filePath, tmpDir });
    });
  });
}

const UPLOAD_RETRIES = 4;
const UPLOAD_RETRY_DELAY_MS = 3000;

async function uploadToServer(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  console.log(`[video] Uploading: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  let lastError;

  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`[video] Retrying upload (attempt ${attempt}/${UPLOAD_RETRIES}) in ${UPLOAD_RETRY_DELAY_MS}ms...`);
      await new Promise(res => setTimeout(res, UPLOAD_RETRY_DELAY_MS));
    }

    try {
      const formData = new FormData();
      formData.append("file", new Blob([fileBuffer]), fileName);

      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          "x-api-key": MEDIA_SRV_API_KEY,
        },
        body: formData,
      });

      const responseText = await response.text();
      console.log(`[video] Upload response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        console.error(`[video] Upload failed: ${response.status} - ${responseText}`);
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (err) {
        console.error(`[video] Failed to parse upload response: ${responseText}`);
        throw new Error(`Server response not JSON: ${responseText.slice(0, 200)}`);
      }

      if (!result.url) {
        console.error(`[video] Server response missing url: ${JSON.stringify(result)}`);
        throw new Error("Server response missing url");
      }

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

function handleMedia(url, format, cmd, { msg, api }) {
  const id = `${format}-${Date.now()}`;

  enqueue(
    async () => {
      try {
        const { filePath, tmpDir } = await downloadMedia(url, id, format);
        const sendMedia = (path) => format === "mp3"
          ? api.sendAudio(path)
          : api.sendVideo(path);

        if (UPL_MEDIA_TO_SRV == "yes") {
          // Upload to server, reply with the link, then also send the file directly
          const downloadUrl = await uploadToServer(filePath);
          await msg.reply(`*Download:*\n${downloadUrl}`);
        } else {
          // Send the file directly — no upload, no link reply
          await sendMedia(filePath);
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        api.log.info(`${cmd} completed → ${url}`);
      } catch (err) {
        console.error(`[video] Task error: ${err.message}`);
        await msg.reply(`${t("error.generic")}\n\`${err.message}\``);
        throw err;
      }
    },
    async () => {
      await msg.reply(t("error.generic"));
    }
  );
}

export default async function ({ msg, api }) {
  if (msg.is(CMD_PREFIX + "video")) {
    const url = msg.args[1];
    if (!url) {
      await msg.reply(`${t("noUrl")} \`${CMD_PREFIX}video https://example.com/...\``);
      return;
    }
    await msg.reply(t("downloading"));
    handleMedia(url, "mp4", CMD_PREFIX + "video", { msg, api });
    return;
  }

  if (msg.is(CMD_PREFIX + "audio")) {
    const url = msg.args[1];
    if (!url) {
      await msg.reply(`${t("noUrl")} \`${CMD_PREFIX}audio https://example.com/...\``);
      return;
    }
    await msg.reply(t("downloading"));
    handleMedia(url, "mp3", CMD_PREFIX + "audio", { msg, api });
    return;
  }
}

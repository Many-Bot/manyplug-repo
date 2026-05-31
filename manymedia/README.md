# ManyMedia
Download videos and audio from YouTube, Reddit, Instagram, and other yt-dlp supported sites — either sending the file directly to chat or uploading to a storage server and sharing the link.

## Features
- **Multi-site support**: YouTube, Reddit, Instagram, SoundCloud, TikTok, and any other yt-dlp compatible site
- **Audio extraction**: Downloads and extracts MP3 at best quality
- **Flexible delivery**: Send file directly to chat, or upload to a storage server and reply with the link
- **Upload retry**: Failed uploads are retried up to 4 times with a 3-second delay
- **Queued processing**: Downloads run in a queue to prevent resource contention
- **Automatic cleanup**: Temporary files removed after delivery

## Requirements
- `yt-dlp` installed and available in `PATH`
- `ffmpeg` it is needed when convering filetypes (e.g. mp4 to mp3) and post-processing, but for downloading is optional
- `cookies.txt` file in the project root (**required** — used for YouTube, Reddit, and other sites that need authentication)

## Usage
```
!video https://youtube.com/watch?v=...
!video https://www.reddit.com/r/...
!video https://www.instagram.com/reel/...
!audio https://youtube.com/watch?v=...
```

## Configuration
Add to `manybot.conf`:

| Key | Default | Description |
|-----|---------|-------------|
| `UPL_MEDIA_TO_SRV` | `no` | Set to `yes` to upload to the storage server and reply with a link instead of sending the file directly |
| `MEDIA_SRV_API_KEY` | — | API key for the storage server (required when `UPL_MEDIA_TO_SRV=yes`) |

### Example
```env
UPL_MEDIA_TO_SRV=yes
MEDIA_SRV_API_KEY=your_api_key_here
```

When `UPL_MEDIA_TO_SRV=no` (default), the file is sent directly to the chat with no external upload.  
When `UPL_MEDIA_TO_SRV=yes`, the file is uploaded to `https://api.stxerr.dev/upload` and the reply contains the download link.

> Make sure to have your API key to use upload. If you don't have one, request it by sending an email to me@stxerr.dev.

## cookies.txt Setup
`cookies.txt` is required for Reddit, YouTube, and other sites that enforce login or rate limits. Without it, downloads from these sites will fail.

**1. Install a browser extension** to export cookies in Netscape format:
- Chrome/Edge: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
- Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

**2. Log in** to Reddit (and YouTube if needed) in your browser.

**3. Export** the cookies using the extension and save the file as `cookies.txt` in the root of the ManyBot project (`/opt/manybot/cookies.txt`).

> Cookies expire over time. If downloads start failing again, re-export and replace the file.

## Localization
Available in:
- English (`locale/en.json`)
- Portuguese (`locale/pt.json`)
- Spanish (`locale/es.json`)

# Audio

Download audio from YouTube and other video sites, convert to MP3, and upload to Maneos storage.

## Features

- **YouTube download**: Extract audio from YouTube videos using yt-dlp
- **MP3 conversion**: Convert any format to MP3 via FFmpeg (192kbps, stereo, 44.1kHz)
- **Auto upload**: Upload converted audio to maneos.net storage
- **Queued processing**: Downloads run in a queue to avoid resource conflicts
- **Automatic cleanup**: Temporary files removed after processing

## Requirements

- `yt-dlp` installed on the system
- `ffmpeg` installed for MP3 conversion
- `cookies.txt` file in the project root (for YouTube downloads)

## Usage

```
!audio https://youtube.com/watch?v=...
```

The bot will:
1. Download the video
2. Extract and convert audio to MP3
3. Upload to maneos.net
4. Reply with the download link

## Configuration

No plugin-specific configuration required. The upload URL is hardcoded to `https://maneos.net/upload`.

## Dependencies

- `yt-dlp` - Video/audio downloader (system dependency)
- `ffmpeg` - Audio conversion (system dependency)
- `cookies.txt` - YouTube authentication cookies (file in project root)

## Localization

Available in:
- English (`locale/en.json`)
- Portuguese (`locale/pt.json`)
- Spanish (`locale/es.json`)


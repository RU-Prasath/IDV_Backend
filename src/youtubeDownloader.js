const path = require('path');
const crypto = require('crypto');

const {
  TMP_DIR,
  YT_DLP_PATH,
  FFMPEG_PATH,
  COOKIES_FILE,
  DownloadError,
  runProcess,
  classifyFailure,
} = require('./common');

// MP3 only supports specific standard bitrates; these are the nearest real
// values to what a "low/medium/high" quality picker would offer.
const AUDIO_BITRATES = [32, 56, 128];

// Max vertical resolution options for the video downloader, up to 4K.
const VIDEO_HEIGHTS = [360, 480, 720, 1080, 1440, 2160];

// 4K downloads are large; give them much more time than the default.
const VIDEO_DOWNLOAD_TIMEOUT_MS = Number(process.env.VIDEO_DOWNLOAD_TIMEOUT_MS || 15 * 60 * 1000);

/**
 * Extracts audio from a YouTube video as an MP3 at the requested bitrate.
 */
async function downloadYoutubeAudio(url, bitrateKbps) {
  if (!AUDIO_BITRATES.includes(bitrateKbps)) {
    throw new DownloadError(`Unsupported bitrate. Choose one of: ${AUDIO_BITRATES.join(', ')} kbps`, 400);
  }

  const id = crypto.randomUUID();
  const outputTemplate = path.join(TMP_DIR, `${id}.%(ext)s`);

  const args = [
    url,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', `${bitrateKbps}K`,
    '--ffmpeg-location', FFMPEG_PATH,
    '-o', outputTemplate,
    '--no-playlist',
    '--no-progress',
    '--print', 'after_move:filepath',
  ];
  if (COOKIES_FILE) {
    args.push('--cookies', COOKIES_FILE);
  }

  const { code, stdout, stderr } = await runProcess(YT_DLP_PATH, args);
  if (code !== 0) {
    throw classifyFailure('yt-dlp', stderr);
  }

  const filePath = stdout.trim().split('\n').filter(Boolean).pop();
  if (!filePath) {
    throw new DownloadError('yt-dlp did not report an output file', 500);
  }
  return filePath;
}

/**
 * Downloads a YouTube video (including Shorts) at the requested max height,
 * merging separate video/audio streams into a single mp4.
 */
async function downloadYoutubeVideo(url, maxHeight) {
  if (!VIDEO_HEIGHTS.includes(maxHeight)) {
    throw new DownloadError(`Unsupported quality. Choose one of: ${VIDEO_HEIGHTS.join(', ')}`, 400);
  }

  const id = crypto.randomUUID();
  const outputTemplate = path.join(TMP_DIR, `${id}.%(ext)s`);

  const args = [
    url,
    '-f', `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`,
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', FFMPEG_PATH,
    '-o', outputTemplate,
    '--no-playlist',
    '--no-progress',
    '--print', 'after_move:filepath',
  ];
  if (COOKIES_FILE) {
    args.push('--cookies', COOKIES_FILE);
  }

  const { code, stdout, stderr } = await runProcess(YT_DLP_PATH, args, { timeoutMs: VIDEO_DOWNLOAD_TIMEOUT_MS });
  if (code !== 0) {
    throw classifyFailure('yt-dlp', stderr);
  }

  const filePath = stdout.trim().split('\n').filter(Boolean).pop();
  if (!filePath) {
    throw new DownloadError('yt-dlp did not report an output file', 500);
  }
  return filePath;
}

module.exports = { downloadYoutubeAudio, downloadYoutubeVideo, AUDIO_BITRATES, VIDEO_HEIGHTS };

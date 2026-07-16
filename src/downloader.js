const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  TMP_DIR,
  YT_DLP_PATH,
  GALLERY_DL_PATH,
  FFMPEG_PATH,
  COOKIES_FILE,
  DownloadError,
  runProcess,
  classifyFailure,
} = require('./common');

/**
 * Video-only: reels, IGTV, and video posts. yt-dlp handles DASH video/audio
 * muxing for these far better than gallery-dl, but has no support at all for
 * photo-only content (it errors with "No video formats found").
 */
async function downloadWithYtDlp(url, id) {
  const outputTemplate = path.join(TMP_DIR, `${id}_%(autonumber)s.%(ext)s`);

  const args = [
    url,
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', FFMPEG_PATH,
    '-o', outputTemplate,
    // Carousels are a "playlist" of slides; download all of them.
    '--yes-playlist',
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

  const filePaths = stdout.trim().split('\n').filter(Boolean);
  if (filePaths.length === 0) {
    throw new DownloadError('yt-dlp did not report any output files', 500);
  }
  return filePaths;
}

/**
 * Images, carousels, and stories: gallery-dl understands Instagram's photo
 * and multi-slide post formats that yt-dlp (a video-only tool) can't touch.
 */
async function downloadWithGalleryDl(url, id) {
  const outputDir = path.join(TMP_DIR, id);
  fs.mkdirSync(outputDir, { recursive: true });

  const args = ['-D', outputDir, '--no-mtime', url];
  if (COOKIES_FILE) {
    args.push('--cookies', COOKIES_FILE);
  }

  const { code, stderr } = await runProcess(GALLERY_DL_PATH, args);
  if (code !== 0) {
    throw classifyFailure('gallery-dl', stderr);
  }

  const filePaths = fs
    .readdirSync(outputDir)
    .sort()
    .map((name) => path.join(outputDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile());
  if (filePaths.length === 0) {
    throw new DownloadError('gallery-dl did not download any files', 500);
  }
  return filePaths;
}

/**
 * Downloads an Instagram reel/post/tv/story. Posts can contain a single
 * video, a single image, or a carousel of multiple images/videos — this
 * always resolves to an array of file paths (length 1 for a single item).
 *
 * Tries yt-dlp first (better video handling); falls back to gallery-dl for
 * anything yt-dlp can't do at all (photo posts, mixed carousels).
 */
async function downloadInstagramMedia(url) {
  const id = crypto.randomUUID();
  try {
    return await downloadWithYtDlp(url, id);
  } catch (ytDlpError) {
    try {
      return await downloadWithGalleryDl(url, id);
    } catch (galleryDlError) {
      // Surface whichever error is more specific than a generic failure.
      throw galleryDlError.statusCode !== 502 ? galleryDlError : ytDlpError;
    }
  }
}

module.exports = { downloadInstagramMedia, DownloadError, TMP_DIR };

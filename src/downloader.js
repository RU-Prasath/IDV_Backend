const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';
const GALLERY_DL_PATH = process.env.GALLERY_DL_PATH || 'gallery-dl';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, '..', 'tmp');
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 60000);

// yt-dlp/gallery-dl both rewrite the cookie jar in place as Instagram rotates
// session tokens. Hosts like Render mount secret files read-only, so copy it
// to a writable path first rather than pointing them at the original.
const COOKIES_FILE = (() => {
  const source = process.env.COOKIES_FILE;
  if (!source) return undefined;
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const writablePath = path.join(TMP_DIR, 'cookies.txt');
  fs.copyFileSync(source, writablePath);
  return writablePath;
})();

class DownloadError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, DOWNLOAD_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new DownloadError(`Failed to start ${command}: ${err.message}`, 500));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new DownloadError('Download timed out', 504));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function classifyFailure(tool, stderr) {
  const lower = stderr.toLowerCase();
  if (lower.includes('private') || lower.includes('login required')) {
    return new DownloadError('This content is private or requires login', 403);
  }
  if (lower.includes('unavailable') || lower.includes('not found') || lower.includes('404')) {
    return new DownloadError('Content is unavailable or the URL is invalid', 404);
  }
  return new DownloadError(`${tool} failed: ${stderr.trim().split('\n').pop() || 'unknown error'}`, 502);
}

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

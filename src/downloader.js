const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, '..', 'tmp');
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 60000);
const COOKIES_FILE = process.env.COOKIES_FILE;

class DownloadError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

function downloadInstagramVideo(url) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const outputTemplate = path.join(TMP_DIR, `${id}.%(ext)s`);

    const args = [
      url,
      '-f', 'mp4/bestvideo+bestaudio/best',
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

    const proc = spawn(YT_DLP_PATH, args, { windowsHide: true });

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
      reject(new DownloadError(`Failed to start yt-dlp: ${err.message}`, 500));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new DownloadError('Download timed out', 504));
        return;
      }

      if (code !== 0) {
        const lower = stderr.toLowerCase();
        if (lower.includes('private') || lower.includes('login required')) {
          reject(new DownloadError('This video is private or requires login', 403));
        } else if (lower.includes('unavailable') || lower.includes('not found') || lower.includes('404')) {
          reject(new DownloadError('Video is unavailable or the URL is invalid', 404));
        } else {
          reject(new DownloadError(`yt-dlp failed: ${stderr.trim().split('\n').pop() || 'unknown error'}`, 502));
        }
        return;
      }

      const filePath = stdout.trim().split('\n').filter(Boolean).pop();
      if (!filePath) {
        reject(new DownloadError('yt-dlp did not report an output file', 500));
        return;
      }

      resolve(filePath);
    });
  });
}

module.exports = { downloadInstagramVideo, DownloadError, TMP_DIR };

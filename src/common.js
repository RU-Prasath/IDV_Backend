const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, '..', 'tmp');
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 60000);

// yt-dlp's --ffmpeg-location checks the given value against the filesystem
// directly rather than resolving it against PATH, so a bare "ffmpeg" only
// works by accident (e.g. if a file named that happens to exist in the
// process's cwd). Resolve to an absolute path up front so it's reliable
// regardless of cwd.
function resolveOnPath(command) {
  if (command.includes('/') || command.includes('\\')) return command;
  try {
    return execFileSync('which', [command]).toString().trim() || command;
  } catch {
    return command;
  }
}

const YT_DLP_PATH = resolveOnPath(process.env.YT_DLP_PATH || 'yt-dlp');
const GALLERY_DL_PATH = resolveOnPath(process.env.GALLERY_DL_PATH || 'gallery-dl');
const FFMPEG_PATH = resolveOnPath(process.env.FFMPEG_PATH || 'ffmpeg');

// yt-dlp/gallery-dl both rewrite the cookie jar in place as some sites rotate
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

function runProcess(command, args, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

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
  // Always log the raw output server-side — the classified message shown to
  // the client is deliberately generic, but debugging needs the real reason.
  console.error(`[${tool}] failed:\n${stderr}`);

  const lower = stderr.toLowerCase();
  if (lower.includes('private') || lower.includes('login required') || lower.includes('sign in')) {
    return new DownloadError('This content is private or requires login', 403);
  }
  if (lower.includes('unavailable') || lower.includes('not found') || lower.includes('404')) {
    return new DownloadError('Content is unavailable or the URL is invalid', 404);
  }
  return new DownloadError(`${tool} failed: ${stderr.trim().split('\n').pop() || 'unknown error'}`, 502);
}

module.exports = {
  TMP_DIR,
  DOWNLOAD_TIMEOUT_MS,
  YT_DLP_PATH,
  GALLERY_DL_PATH,
  FFMPEG_PATH,
  COOKIES_FILE,
  DownloadError,
  runProcess,
  classifyFailure,
};

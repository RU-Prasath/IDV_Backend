require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const archiver = require('archiver');

const { isValidInstagramUrl } = require('./instagramUrl');
const { downloadInstagramMedia, DownloadError, TMP_DIR } = require('./downloader');
const { isValidYoutubeVideoUrl } = require('./youtubeUrl');
const { downloadYoutubeAudio, AUDIO_BITRATES } = require('./youtubeDownloader');
const { mimeTypeFor } = require('./mime');

const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
// Render (and most PaaS hosts) sit behind a reverse proxy; this makes
// express-rate-limit key off the real client IP instead of the proxy's.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/download', downloadLimiter, async (req, res) => {
  const { url } = req.body || {};

  if (!isValidInstagramUrl(url)) {
    return res
      .status(400)
      .json({ error: 'Invalid IVD URL. Expected a reel, post, tv, or story link from instagram.com.' });
  }

  let filePaths;
  try {
    filePaths = await downloadInstagramMedia(url.trim());
  } catch (err) {
    const statusCode = err instanceof DownloadError ? err.statusCode : 500;
    return res.status(statusCode).json({ error: err.message });
  }

  const cleanup = () => {
    const parentDirs = new Set();
    for (const filePath of filePaths) {
      fs.unlink(filePath, () => {});
      parentDirs.add(path.dirname(filePath));
    }
    // gallery-dl downloads into a per-request subfolder; remove it once empty.
    for (const dir of parentDirs) {
      if (dir !== TMP_DIR) {
        fs.rmdir(dir, () => {});
      }
    }
  };

  try {
    if (filePaths.length === 1) {
      const [filePath] = filePaths;
      res.setHeader('Content-Type', mimeTypeFor(filePath));
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);

      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        cleanup();
        if (!res.headersSent) {
          res.status(500).json({ error: `Failed to stream file: ${err.message}` });
        } else {
          res.destroy();
        }
      });
      stream.on('close', cleanup);

      stream.pipe(res);
      return;
    }

    // Carousel post: multiple slides, bundle them into a zip.
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ivd_carousel.zip"');

    const archive = archiver('zip');
    archive.on('error', (err) => {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to build zip: ${err.message}` });
      } else {
        res.destroy();
      }
    });
    archive.on('end', cleanup);

    archive.pipe(res);
    filePaths.forEach((filePath, index) => {
      archive.file(filePath, { name: `${index + 1}${path.extname(filePath)}` });
    });
    archive.finalize();
  } catch (err) {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to prepare response: ${err.message}` });
    } else {
      res.destroy();
    }
  }
});

app.post('/api/youtube/audio', downloadLimiter, async (req, res) => {
  const { url, bitrate } = req.body || {};
  const bitrateKbps = Number(bitrate);

  if (!isValidYoutubeVideoUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }
  if (!AUDIO_BITRATES.includes(bitrateKbps)) {
    return res.status(400).json({ error: `Invalid bitrate. Choose one of: ${AUDIO_BITRATES.join(', ')} kbps` });
  }

  let filePath;
  try {
    filePath = await downloadYoutubeAudio(url.trim(), bitrateKbps);
  } catch (err) {
    const statusCode = err instanceof DownloadError ? err.statusCode : 500;
    return res.status(statusCode).json({ error: err.message });
  }

  const cleanup = () => fs.unlink(filePath, () => {});

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);

  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to stream file: ${err.message}` });
    } else {
      res.destroy();
    }
  });
  stream.on('close', cleanup);
  stream.pipe(res);
});

// A synchronous throw anywhere outside a request handler (or a bug like an
// unexpectedly-shaped dependency) would otherwise kill the whole process;
// log it and keep serving instead of crash-looping.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

app.listen(PORT, () => {
  console.log(`ReelSaver backend listening on port ${PORT}`);
});

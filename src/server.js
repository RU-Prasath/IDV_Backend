require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { isValidInstagramUrl } = require('./instagramUrl');
const { downloadInstagramVideo, DownloadError, TMP_DIR } = require('./downloader');

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
    return res.status(400).json({ error: 'Invalid IVD URL. Expected instagram.com/(reel|p|tv)/<id>/' });
  }

  let filePath;
  try {
    filePath = await downloadInstagramVideo(url.trim());
  } catch (err) {
    const statusCode = err instanceof DownloadError ? err.statusCode : 500;
    return res.status(statusCode).json({ error: err.message });
  }

  const cleanup = () => {
    fs.unlink(filePath, () => {});
  };

  res.setHeader('Content-Type', 'video/mp4');
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

app.listen(PORT, () => {
  console.log(`ReelSaver backend listening on port ${PORT}`);
});

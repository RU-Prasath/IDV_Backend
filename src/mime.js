const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

function mimeTypeFor(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

module.exports = { mimeTypeFor };

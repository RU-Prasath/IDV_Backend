const INSTAGRAM_URL_REGEX =
  /^https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\/[A-Za-z0-9_-]+\/?(\?.*)?$/i;

function isValidInstagramUrl(url) {
  return typeof url === 'string' && INSTAGRAM_URL_REGEX.test(url.trim());
}

module.exports = { isValidInstagramUrl, INSTAGRAM_URL_REGEX };

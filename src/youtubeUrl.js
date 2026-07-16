// Matches youtube.com/watch?v=, youtu.be/, m.youtube.com/watch?v=, shorts, and
// a channel's community post permalink (youtube.com/channel/<id>/community or
// youtube.com/post/<id>).
const YOUTUBE_VIDEO_URL_REGEX =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=[\w-]+|shorts\/[\w-]+)|youtu\.be\/[\w-]+)(&\S*|\?\S*)?$/i;

const YOUTUBE_COMMUNITY_URL_REGEX =
  /^https?:\/\/(www\.)?youtube\.com\/(channel\/[\w-]+\/community\/?\?lb=[\w-]+|post\/[\w-]+)(\?\S*)?$/i;

function isValidYoutubeVideoUrl(url) {
  return typeof url === 'string' && YOUTUBE_VIDEO_URL_REGEX.test(url.trim());
}

function isValidYoutubeCommunityUrl(url) {
  return typeof url === 'string' && YOUTUBE_COMMUNITY_URL_REGEX.test(url.trim());
}

module.exports = {
  isValidYoutubeVideoUrl,
  isValidYoutubeCommunityUrl,
  YOUTUBE_VIDEO_URL_REGEX,
  YOUTUBE_COMMUNITY_URL_REGEX,
};

FROM node:20-slim

# yt-dlp (video) needs Python + ffmpeg for muxing; gallery-dl (images/carousels)
# needs just Python.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp gallery-dl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV YT_DLP_PATH=yt-dlp
ENV GALLERY_DL_PATH=gallery-dl
ENV FFMPEG_PATH=ffmpeg
ENV TMP_DIR=/app/tmp

EXPOSE 3000

CMD ["node", "src/server.js"]

# Video Watchtime Dashboard — nothing here touches the host machine; the
# image bundles the Bun runtime (which includes the HTTP server and SQLite).
FROM oven/bun:1-slim

WORKDIR /app
COPY app.js ./
COPY static ./static

ENV PORT=3000
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000

CMD ["bun", "app.js"]

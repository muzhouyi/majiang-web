FROM node:24-alpine

LABEL org.opencontainers.image.title="Dongguang Mahjong"
LABEL org.opencontainers.image.description="Browser Mahjong game using the confirmed Dongguang rules"
LABEL org.opencontainers.image.version="1.7"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3019 \
    TZ=Asia/Shanghai

COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public

USER node

EXPOSE 3019

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3019/ || exit 1

CMD ["node", "server.js"]

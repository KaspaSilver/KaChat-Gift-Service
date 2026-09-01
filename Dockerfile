# The gift service. Node because the payout path uses the official Kaspa WASM
# SDK, which is where transaction building and signing belong -- rolling those
# by hand is how a faucet pays the wrong person the wrong amount.
FROM node:22-alpine

RUN apk add --no-cache ca-certificates tini \
    && addgroup -S gift \
    && adduser -S -G gift -h /home/gift -s /sbin/nologin gift \
    && mkdir -p /conf /data \
    && chown -R gift:gift /data /home/gift

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY service ./service

ENV NODE_ENV=production \
    GIFT_PORT=8770 \
    GIFT_CONF=/conf/gift.json \
    GIFT_DATA=/data

EXPOSE 8770

# Reads its wallet key and store credentials from /conf, which is mounted at run
# time and never built into this image.
USER gift
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8770/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "node", "service/server.js"]

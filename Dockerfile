# syntax=docker/dockerfile:1
# Unified xbond daemon image (port mode): full LocalAPI + dual cores + web
# UI. This is NOT the openxbond/docker-sing-box wrapper image — see
# docs/specs/docker-daemon.md for the contract and the boundary between them.

# --- web UI bundle -----------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/client-ui/package.json packages/client-ui/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts uno.config.ts ./
COPY apps/dashboard apps/dashboard
COPY packages/client packages/client
COPY packages/client-ui packages/client-ui
RUN pnpm build

# --- daemon binary (both cores, same tags as pnpm cli:check) -----------------
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" \
      -tags with_gvisor,with_quic,with_utls,with_clash_api \
      -o /out/xbond ./cmd/xbond

# --- runtime -----------------------------------------------------------------
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -g 1000 xbond \
    && adduser -D -u 1000 -G xbond -h /data xbond \
    && mkdir -p /data /app/dist \
    && chown -R xbond:xbond /data /app
COPY --from=build /out/xbond /usr/local/bin/xbond
COPY --from=web --chown=xbond:xbond /src/dist /app/dist

# Headless defaults: port takeover (sysproxy/TUN are meaningless in a
# container), LAN binding so published ports work, fixed proxy port, and the
# active subscription's core comes up on boot. All four can be overridden
# per container via -e; see the spec for semantics.
ENV XBOND_DATA_DIR=/data \
    XBOND_TAKEOVER_MODE=port \
    XBOND_ALLOW_LAN=true \
    XBOND_MIXED_PORT=7890 \
    XBOND_AUTOSTART=1

VOLUME ["/data"]
# 7890: mixed proxy inbound. 9090: LocalAPI + web UI (the served index
# carries the per-boot access token — publish this port to trusted
# interfaces only).
EXPOSE 7890 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:9090/ || exit 1

USER xbond
WORKDIR /app
ENTRYPOINT ["xbond", "daemon", "--listen", "0.0.0.0:9090", "--web-dir", "/app/dist"]

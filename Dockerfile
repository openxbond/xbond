# syntax=docker/dockerfile:1
# Official XBond image with the daemon, both proxy cores and the Web UI.

# --- web UI bundle -----------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/client-ui/package.json packages/client-ui/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY apps/dashboard apps/dashboard
COPY packages/client packages/client
COPY packages/client-ui packages/client-ui
ARG XBOND_VERSION
RUN XBOND_VERSION="$XBOND_VERSION" pnpm build

# --- daemon binary (both cores, same tags as pnpm cli:check) -----------------
# BUILD_TAGS must stay pinned to scripts/dev/go.ts (enforced by scripts/dev/go.test.ts).
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG XBOND_VERSION
ARG BUILD_TAGS=with_gvisor,with_quic,with_utls,with_clash_api
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath \
      -ldflags "-s -w -X github.com/openxbond/xbond/internal/version.Version=${XBOND_VERSION:-dev}" \
      -tags ${BUILD_TAGS} \
      -o /out/xbond ./cmd/xbond

# --- runtime -----------------------------------------------------------------
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget iptables su-exec \
    && addgroup -g 1000 xbond \
    && adduser -D -u 1000 -G xbond -h /data xbond \
    && mkdir -p /data /app/dist \
    && chown -R xbond:xbond /data /app
COPY --from=build /out/xbond /usr/local/bin/xbond
COPY --from=web --chown=xbond:xbond /src/dist/web /app/dist

# The image defaults to port mode. Linux gateways opt into TUN and run as root.
ENV XBOND_DATA_DIR=/data \
    XBOND_TAKEOVER_MODE=port \
    XBOND_ALLOW_LAN=true \
    XBOND_MIXED_PORT=7890 \
    XBOND_AUTOSTART=1

VOLUME ["/data"]
# 7890: mixed proxy inbound. 19090: LocalAPI + web UI (the served index
# carries the per-boot access token — publish this port to trusted
# interfaces only).
EXPOSE 7890 19090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:19090/ || exit 1

COPY --chmod=755 scripts/dev/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
WORKDIR /app
ENTRYPOINT ["docker-entrypoint"]
CMD ["--listen", "0.0.0.0:19090"]

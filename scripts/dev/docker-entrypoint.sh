#!/bin/sh
set -eu

set -- --listen "$XBOND_DASHBOARD_LISTEN"

case "${XBOND_TAKEOVER_MODE:-port}" in
  port)
    if [ "$(id -u)" = 0 ]; then
      # A gateway may have written root-owned state to this same volume.
      chown -Rh xbond:xbond "$XBOND_DATA_DIR"
      exec su-exec xbond xbond daemon --web-dir /app/dist "$@"
    fi
    ;;
  tun)
    if [ "$(id -u)" != 0 ] || [ ! -c /dev/net/tun ]; then
      echo "TUN requires root, NET_ADMIN and /dev/net/tun" >&2
      exit 1
    fi
    ;;
  *)
    echo "XBOND_TAKEOVER_MODE must be port or tun in Docker" >&2
    exit 1
    ;;
esac

exec xbond daemon --web-dir /app/dist "$@"

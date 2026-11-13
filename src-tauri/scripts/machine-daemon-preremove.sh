#!/bin/sh
# Machine-scope daemon reclaim on genuine package removal (AC-8): the
# privileged tunnel host must not outlive the application that installed it.
# Maintainer scripts run as root, so the systemd operations need no further
# elevation. Gated on the removal argument — package managers also run this
# script on upgrade, which must leave a running tunnel untouched; the machine
# daemon updates itself through `daemon system-upgrade` instead.
#
# The registration files go before the stop: the unit's Restart=always cannot
# resurrect a registration whose unit file and binary are gone, and the
# explicit stop job suppresses the restart for the loaded instance. The
# machine data directory (/var/lib/xbond-system) is kept, matching the
# uninstall contract.

case "$1" in
remove | 0) ;;
*) exit 0 ;;
esac

if ! command -v systemctl >/dev/null 2>&1; then
  exit 0
fi

if [ -e /etc/systemd/system/xbond-daemon-system.service ]; then
  systemctl stop xbond-daemon-system.service || true
  rm -f /etc/systemd/system/xbond-daemon-system.service /usr/lib/xbond/xbond \
    /usr/lib/xbond/install-owner /usr/lib/xbond/install-owner-path
  rmdir --ignore-fail-on-non-empty /usr/lib/xbond 2>/dev/null || true
  systemctl daemon-reload || true
fi

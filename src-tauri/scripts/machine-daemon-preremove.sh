#!/bin/sh
# Machine-scope daemon reclaim and full data cleanup on genuine package
# removal (uninstall contract: no residue kept). Maintainer scripts run as
# root, so the systemd operations need no further elevation.
#
# Gated on the removal argument — package managers also run this script on
# upgrade, which must leave a running tunnel and all user data untouched; the
# machine daemon updates itself through `daemon system-upgrade` instead.
#
# The registration files go before the stop: the unit's Restart=always cannot
# resurrect a registration whose unit file and binary are gone, and the
# explicit stop job suppresses the restart for the loaded instance.
#
# A genuine removal wipes both layers: the machine data directory
# (/var/lib/xbond-system) and every invoking user's data directory and the
# systemd --user registration that owns it. The service-manager registration
# is reclaimed first so no tunnel survives the application that installed it.
# User data goes through the CLI's purge verb so the path resolution stays in
# one place (XDG_DATA_HOME honoured, same as the daemon itself).

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
rm -rf /var/lib/xbond-system

# Every real login user that ever ran the daemon leaves a data directory and
# a user unit behind; both go on genuine removal. system users (nologin /
# false shells) never run a user session daemon and are skipped.
for home in /home/* /root; do
  [ -d "$home" ] || continue
  user=$(basename "$home")
  case "$user" in
  *:* | *\ * | *\\* | .* | nobody | nogroup) continue ;;
  esac
  if ! id "$user" >/dev/null 2>&1; then
    continue
  fi
  shell=$(getent passwd "$user" 2>/dev/null | cut -d: -f7)
  case "$shell" in
  */nologin | */false | "") continue ;;
  esac
  data_home="$home/.local/share"
  if [ -f "$home/.config/user-dirs.dirs" ]; then
    # shellcheck disable=SC1091
    custom=$( ( . "$home/.config/user-dirs.dirs" 2>/dev/null; printf '%s' "${XDG_DATA_HOME:-}" ) )
    case "$custom" in
    "$home"/*) data_home="$custom" ;;
    esac
  fi
  # The packaged CLI resolves its own data directory, so this stays correct
  # even if the layout ever changes; the fallback covers a binary already
  # removed by an interrupted upgrade.
  if [ -x /usr/bin/xbond ]; then
    su -s /bin/sh "$user" -c '/usr/bin/xbond daemon purge-user-data' 2>/dev/null || true
  fi
  if [ -d "$data_home/xbond" ]; then
    rm -rf "$data_home/xbond"
  fi
  unit="$home/.config/systemd/user/xbond-daemon.service"
  if [ -e "$unit" ]; then
    uid=$(id -u "$user" 2>/dev/null) || continue
    # Stop the user instance through its own manager: the daemon is supervised
    # by systemd --user, so a bare kill leaves the manager respawning it.
    # systemctl --machine reaches a lingering manager without a login session;
    # XDG_RUNTIME_DIR covers managers started outside logind (sudo -u service).
    if [ -d "/run/user/$uid" ]; then
      systemctl --machine "$user@" --user disable --now xbond-daemon.service 2>/dev/null || \
        XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user disable --now xbond-daemon.service 2>/dev/null || true
    fi
    rm -f "$unit"
    rmdir --ignore-fail-on-non-empty "$home/.config/systemd/user" 2>/dev/null || true
  fi
done

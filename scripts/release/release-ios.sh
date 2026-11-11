#!/usr/bin/env bash
# Signs the iOS App Store archive: an ephemeral keychain holds the
# distribution certificate, the provisioning profiles are installed, and
# scripts/release/build-ios-release.sh archives the signed IPA from the Tauri
# gen/apple project.
#
# Env contract (the release-ios-signing environment):
#   IOS_DISTRIBUTION_P12       base64 PKCS#12 distribution certificate
#   IOS_DISTRIBUTION_PASSWORD  password for that certificate
#   IOS_APP_PROFILE            base64 App Store provisioning profile
#   IOS_TUNNEL_PROFILE         base64 PacketTunnel provisioning profile
# Everything build-release.sh needs (APPLE_TEAM_ID, XBOND_VERSION,
# XBOND_BUILD_NUMBER, XBOND_APP_STORE_URL) passes through the environment.
#
# Usage: bash scripts/release/release-ios.sh archive <output directory>
set -euo pipefail

if [[ $# != 2 || $1 != archive ]]; then
  echo "Usage: bash scripts/release/release-ios.sh archive <output directory>" >&2
  exit 1
fi
: "${IOS_DISTRIBUTION_P12:?Set the distribution certificate}"
: "${IOS_DISTRIBUTION_PASSWORD:?Set the distribution certificate password}"
: "${IOS_APP_PROFILE:?Set the App Store provisioning profile}"
: "${IOS_TUNNEL_PROFILE:?Set the PacketTunnel provisioning profile}"

work="$(mktemp -d)"
keychain="$work/xbond.keychain-db"
cleanup() {
  security delete-keychain "$keychain" 2>/dev/null || true
  rm -rf -- "$work"
}
trap cleanup EXIT

password="$(openssl rand -hex 24)"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security list-keychains -d user -s "$keychain"

printf '%s' "$IOS_DISTRIBUTION_P12" | base64 -D > "$work/cert.p12"
security import "$work/cert.p12" -f pkcs12 -k "$keychain" -P "$IOS_DISTRIBUTION_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain"

install_profile() {
  local profile="$work/$1.mobileprovision"
  local uuid
  base64 -D > "$profile"
  security cms -D -i "$profile" > "$work/$1.plist"
  uuid="$(/usr/libexec/PlistBuddy -c 'Print UUID' "$work/$1.plist")"
  for profile_dir in "$HOME/Library/MobileDevice/Provisioning Profiles" \
    "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
    mkdir -p "$profile_dir"
    cp "$profile" "$profile_dir/$uuid.mobileprovision"
  done
  printf '%s' "$uuid"
}

APPLE_APP_PROFILE="$(printf '%s' "$IOS_APP_PROFILE" | install_profile app)"
APPLE_TUNNEL_PROFILE="$(printf '%s' "$IOS_TUNNEL_PROFILE" | install_profile tunnel)"
export APPLE_APP_PROFILE APPLE_TUNNEL_PROFILE

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash "$repo/scripts/release/build-ios-release.sh" "$2"

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
: "${APPLE_TEAM_ID:?Set the Apple Developer team ID}"

pnpm ios:bind

work="$(mktemp -d)"
keychain="$work/xbond.keychain-db"
original_keychains=()
installed_profiles=()
keychain_search_changed=false
cleanup() {
  if $keychain_search_changed; then
    security list-keychains -d user -s ${original_keychains[@]+"${original_keychains[@]}"}
  fi
  security delete-keychain "$keychain" 2>/dev/null || true
  for profile in ${installed_profiles[@]+"${installed_profiles[@]}"}; do
    rm -f -- "$profile"
  done
  rm -rf -- "$work"
}
trap cleanup EXIT

keychain_list="$(security list-keychains -d user)"
while IFS= read -r entry; do
  if [[ "$entry" == *\"*\" ]]; then
    entry="${entry#*\"}"
    original_keychains+=("${entry%\"}")
  fi
done <<< "$keychain_list"
password="$(openssl rand -hex 24)"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security list-keychains -d user -s "$keychain" ${original_keychains[@]+"${original_keychains[@]}"}
keychain_search_changed=true

printf '%s' "$IOS_DISTRIBUTION_P12" | base64 -D > "$work/cert.p12"
security import "$work/cert.p12" -f pkcs12 -k "$keychain" -P "$IOS_DISTRIBUTION_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain"

install_profile() {
  local profile="$work/$1.mobileprovision"
  local profile_dir destination
  printf '%s' "$2" | base64 -D > "$profile"
  security cms -D -i "$profile" > "$work/$1.plist"
  profile_uuid="$(/usr/libexec/PlistBuddy -c 'Print UUID' "$work/$1.plist")"
  for profile_dir in "$HOME/Library/MobileDevice/Provisioning Profiles" \
    "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
    mkdir -p "$profile_dir"
    destination="$profile_dir/$profile_uuid.mobileprovision"
    if [[ -e "$destination" ]]; then
      if ! cmp -s "$profile" "$destination"; then
        echo "A different provisioning profile already exists at $destination" >&2
        return 1
      fi
    else
      cp "$profile" "$destination"
      installed_profiles+=("$destination")
    fi
  done
}

install_profile app "$IOS_APP_PROFILE"
APPLE_APP_PROFILE="$profile_uuid"
install_profile tunnel "$IOS_TUNNEL_PROFILE"
APPLE_TUNNEL_PROFILE="$profile_uuid"
export APPLE_APP_PROFILE APPLE_TUNNEL_PROFILE

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash "$repo/scripts/release/build-ios-release.sh" "$2"

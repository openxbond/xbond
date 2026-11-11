#!/usr/bin/env bash
# Archives with the Tauri CLI and exports with both provisioning profiles.
#
# Env contract (the release-ios-signing environment):
#   APPLE_TEAM_ID            Apple Developer team ID
#   APPLE_APP_PROFILE        installed App Store provisioning profile name
#   APPLE_TUNNEL_PROFILE     installed PacketTunnel provisioning profile name
#   XBOND_VERSION / XBOND_BUILD_NUMBER / XBOND_APP_STORE_URL
#   APPLE_SIGNING_IDENTITY   defaults to "Apple Distribution"
#
# Usage: bash scripts/build-ios-release.sh <output directory>
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "Usage: bash scripts/build-ios-release.sh <output directory>" >&2
  exit 2
fi
: "${XBOND_VERSION:?Set the release version}"
: "${XBOND_BUILD_NUMBER:?Set the release build number}"
: "${APPLE_TEAM_ID:?Set the Apple Developer team ID}"
: "${APPLE_APP_PROFILE:?Set the installed app provisioning profile name}"
: "${APPLE_TUNNEL_PROFILE:?Set the installed tunnel provisioning profile name}"
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Apple Distribution}"
[[ "$XBOND_VERSION" =~ ^(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)$ ]]
[[ "$XBOND_BUILD_NUMBER" =~ ^[1-9][0-9]{0,5}$ ]]
XBOND_APP_STORE_URL="${XBOND_APP_STORE_URL:-}"
[[ -z "$XBOND_APP_STORE_URL" || ( "$XBOND_APP_STORE_URL" == https://apps.apple.com/* && "$XBOND_APP_STORE_URL" != *[[:space:]]* ) ]]
sdk_version="$(xcrun --sdk iphoneos --show-sdk-version)"
if [[ "${sdk_version%%.*}" -lt 26 ]]; then
  echo "App Store archives require the iOS 26 SDK or newer. Found $sdk_version." >&2
  exit 1
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apple="$repo/src-tauri/gen/apple"
mkdir -p "$1"
out="$(cd "$1" && pwd)"
work="$(mktemp -d "$out/.ios-build-XXXXXX")"
release_config="$apple/XBond.release.local.xcconfig"
config_linked=false
cleanup() {
  if $config_linked; then
    unlink "$release_config"
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT

# The gen project is committed with its xcodegen spec; regenerate the
# xcodeproj so scheme/target changes from project.yml edits always land.
xcodegen generate --spec "$apple/project.yml" --project "$apple"

store_url=""
if [[ -n "$XBOND_APP_STORE_URL" ]]; then
  # Escape the URL separator so xcconfig does not treat it as a comment.
  store_url='https:/$()/'"${XBOND_APP_STORE_URL#https://}"
fi

cat > "$work/Release.xcconfig" <<EOF
XBOND_MARKETING_VERSION = $XBOND_VERSION
DEVELOPMENT_TEAM = $APPLE_TEAM_ID
CODE_SIGN_STYLE = Manual
CODE_SIGN_IDENTITY = $APPLE_SIGNING_IDENTITY
XBOND_APP_PROFILE = $APPLE_APP_PROFILE
XBOND_TUNNEL_PROFILE = $APPLE_TUNNEL_PROFILE
XBOND_APP_STORE_URL = $store_url
EOF
ln -s "$work/Release.xcconfig" "$release_config"
config_linked=true

(
  cd "$repo"
  APPLE_DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
    pnpm tauri ios build --ci --target aarch64 --archive-only \
    --config "{\"version\":\"$XBOND_VERSION\",\"bundle\":{\"iOS\":{\"bundleVersion\":\"$XBOND_BUILD_NUMBER\"}}}"
)

archive="$apple/build/xbond-app_iOS.xcarchive"
app="$archive/Products/Applications/XBond.app"
tunnel="$app/PlugIns/PacketTunnel.appex"
codesign --verify --deep --strict "$app"
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" == net.xbond.app ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$tunnel/Info.plist")" == net.xbond.app.PacketTunnel ]]
for bundle in "$app" "$tunnel"; do
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$bundle/Info.plist")" == "$XBOND_VERSION" ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$bundle/Info.plist")" == "$XBOND_BUILD_NUMBER" ]]
done

python3 - "$work/ExportOptions.plist" <<'PY'
import os
import plistlib
import sys

with open(sys.argv[1], "wb") as output:
    plistlib.dump({
        "method": "app-store-connect",
        "destination": "export",
        "signingStyle": "manual",
        "signingCertificate": os.environ["APPLE_SIGNING_IDENTITY"],
        "teamID": os.environ["APPLE_TEAM_ID"],
        "manageAppVersionAndBuildNumber": False,
        "provisioningProfiles": {
            "net.xbond.app": os.environ["APPLE_APP_PROFILE"],
            "net.xbond.app.PacketTunnel": os.environ["APPLE_TUNNEL_PROFILE"],
        },
    }, output)
PY
xcodebuild -exportArchive -archivePath "$archive" \
  -exportPath "$work/export" -exportOptionsPlist "$work/ExportOptions.plist"
mv "$work/export/XBond.ipa" "$out/xbond-ios-v$XBOND_VERSION.ipa"

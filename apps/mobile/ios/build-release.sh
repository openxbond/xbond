#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "Usage: bash apps/mobile/ios/build-release.sh <output directory>" >&2
  exit 1
fi
: "${XBOND_VERSION:?Set the release version}"
: "${XBOND_BUILD_NUMBER:?Set the release build number}"
: "${XBOND_APP_STORE_URL:?Set the public App Store URL}"
: "${APPLE_TEAM_ID:?Set the Apple Developer team ID}"
: "${APPLE_APP_PROFILE:?Set the installed app provisioning profile name}"
: "${APPLE_TUNNEL_PROFILE:?Set the installed tunnel provisioning profile name}"
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Apple Distribution}"
[[ "$XBOND_VERSION" =~ ^(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)$ ]]
[[ "$XBOND_BUILD_NUMBER" =~ ^[1-9][0-9]{0,5}$ ]]
[[ "$XBOND_APP_STORE_URL" == https://apps.apple.com/* ]]
sdk_version="$(xcrun --sdk iphoneos --show-sdk-version)"
if [[ "${sdk_version%%.*}" -lt 26 ]]; then
  echo "App Store archives require the iOS 26 SDK or newer. Found $sdk_version." >&2
  exit 1
fi

ios="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$1"
out="$(cd "$1" && pwd)"
test -f "$ios/../../../dist/index.html"
test -f "$ios/XBondMobile.xcframework/Info.plist"
xcodegen generate --spec "$ios/project.yml" --project "$ios"

xcodebuild -project "$ios/XBond.xcodeproj" -scheme XBond \
  -destination 'generic/platform=iOS' -archivePath "$out/XBond.xcarchive" \
  MARKETING_VERSION="$XBOND_VERSION" CURRENT_PROJECT_VERSION="$XBOND_BUILD_NUMBER" \
  XBOND_APP_STORE_URL="$XBOND_APP_STORE_URL" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$APPLE_SIGNING_IDENTITY" \
  XBOND_APP_PROFILE="$APPLE_APP_PROFILE" XBOND_TUNNEL_PROFILE="$APPLE_TUNNEL_PROFILE" \
  archive

app="$out/XBond.xcarchive/Products/Applications/XBond.app"
codesign --verify --deep --strict "$app"
for bundle in "$app" "$app/PlugIns/PacketTunnel.appex"; do
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$bundle/Info.plist")" == "$XBOND_VERSION" ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$bundle/Info.plist")" == "$XBOND_BUILD_NUMBER" ]]
done

python3 - "$out/ExportOptions.plist" <<'PY'
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
xcodebuild -exportArchive -archivePath "$out/XBond.xcarchive" \
  -exportPath "$out/export" -exportOptionsPlist "$out/ExportOptions.plist"
mv "$out/export/XBond.ipa" "$out/xbond.ipa"

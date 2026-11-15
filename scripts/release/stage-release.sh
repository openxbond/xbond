#!/usr/bin/env bash
set -euo pipefail

tag=$1
directory="release/$tag/assets"
(cd "$directory" && sha256sum --strict --check SHA256SUMS)
jq -e '.mode == "release"' "$directory/release-evidence.json" > /dev/null
prerelease=$(jq -r '.prerelease // false' "$directory/release-evidence.json")
create_flags=(--verify-tag --draft --title "XBond $tag" --notes-file release-notes.md)
if [[ "$prerelease" == "true" ]]; then
  create_flags+=(--prerelease)
fi
if ! release=$(gh release view "$tag" --json isDraft,isPrerelease,assets); then
  gh release create "$tag" "${create_flags[@]}"
  release=$(gh release view "$tag" --json isDraft,isPrerelease,assets)
fi
jq -e '.isDraft' <<< "$release" > /dev/null
if [[ "$prerelease" == "true" ]]; then
  jq -e '.isPrerelease' <<< "$release" > /dev/null
fi

# A rerun resumes an interrupted upload without replacing any reviewed bytes.
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
while IFS= read -r name; do
  [[ -f "$directory/$name" ]] || { echo "Unexpected draft asset: $name" >&2; exit 1; }
  gh release download "$tag" --pattern "$name" --dir "$temporary"
  cmp "$directory/$name" "$temporary/$name"
done < <(jq -r '.assets[].name' <<< "$release")

for asset in "$directory"/*; do
  if [[ ! -f "$temporary/${asset##*/}" ]]; then
    gh release upload "$tag" "$asset"
  fi
done

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  draft_url=$(gh release view "$tag" --json url --jq '.url')
  if [[ "$(jq -r '.iosSHA256' "$directory/release-evidence.json")" == "" ]]; then
    testflight_step='2. This candidate has no iOS archive (distribution credentials absent); macOS installers are ad-hoc signed. Configure Apple credentials and rebuild a later tag for TestFlight and notarized installers.'
  else
    testflight_step='2. Run **Submit XBond to TestFlight** for this tag, then verify installation through TestFlight.'
  fi
  if [[ "$prerelease" == "true" ]]; then
    publish_step='3. This is a release candidate: do not run **Publish XBond release** (stable). After verification, tag the stable `vX.Y.Z` release for the same line.'
  else
    publish_step='3. Run **Publish XBond release** for this tag and confirm installation verification. Use the same candidate for later store submissions.'
  fi
  {
    printf '### %s is ready for installation checks\n\n' "$tag"
    printf '[Release draft](%s)\n\n' "$draft_url"
    printf '1. Verify the installers.\n'
    printf '%s\n' "$testflight_step"
    printf '%s\n' "$publish_step"
  } >> "$GITHUB_STEP_SUMMARY"
fi

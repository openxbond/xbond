#!/usr/bin/env bash
set -euo pipefail

tag=$1
directory=release/assets
(cd "$directory" && sha256sum --strict --check SHA256SUMS)
jq -e '.mode == "release"' "$directory/release-evidence.json" > /dev/null
if ! release=$(gh release view "$tag" --json isDraft,assets); then
  gh release create "$tag" --verify-tag --draft --title "XBond $tag" --notes-file release-notes.md
  release=$(gh release view "$tag" --json isDraft,assets)
fi
jq -e '.isDraft' <<< "$release" > /dev/null

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
  {
    printf '### %s is ready for installation checks\n\n' "$tag"
    printf '[Release draft](%s)\n\n' "$draft_url"
    printf '1. Verify the installers and the Chrome and Edge ZIP.\n'
    printf '2. Run **XBond store operations** for this tag with `ios` / `submit`, then verify installation through TestFlight.\n'
    printf '3. Run **Publish XBond release** for this tag and confirm installation verification. Use the same candidate for later store submissions.\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi

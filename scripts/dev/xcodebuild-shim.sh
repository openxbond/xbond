#!/bin/sh
# Xcode 18 resolves `xcodebuild archive` to a generic run destination through
# an ambiguous anyObject pick (Xcode logs its own "please file a bug"
# assertion): the pick can land on "Any iOS Device", which makes simulator
# dev builds demand a signing team, and neither a concrete nor a missing
# -destination avoids it because the conversion ignores both. cargo-mobile2
# (tauri-apps/tauri#14233) hands the archive a concrete simulator name on
# Intel hosts and no destination on arm64, so it cannot dodge the bug. The
# explicit generic simulator destination skips the conversion and resolves
# deterministically: rewrite only debug archives to it. Device and release
# archives keep their destination untouched.
#
# scripts/dev/mobile.ts stages this script into a temp dir (mutagen does not
# preserve the executable bit) and prepends its directory to the dev loop's
# PATH, so only `pnpm dev:ios` invocations see it.
set -eu

real=/usr/bin/xcodebuild
is_archive=0
configuration=
prev=
for arg in "$@"; do
  if [ "$arg" = archive ]; then
    is_archive=1
  fi
  if [ "$prev" = "-configuration" ]; then
    configuration=$arg
  fi
  prev=$arg
done

if [ "$is_archive" = 0 ]; then
  exec "$real" "$@"
fi
case "$configuration" in
  [Dd]ebug) ;;
  *) exec "$real" "$@" ;;
esac

# Rebuild the arguments without any -destination pair, remembering whether
# the removed destination was already generic.
had_generic=0
skip=0
first=1
for arg in "$@"; do
  if [ "$skip" = 1 ]; then
    skip=0
    case "$arg" in generic/*) had_generic=1 ;; esac
    continue
  fi
  if [ "$arg" = "-destination" ]; then
    skip=1
    continue
  fi
  case "$arg" in
    -destination=generic/*) had_generic=1 ;;
    -destination=*) continue ;;
  esac
  if [ "$first" = 1 ]; then
    set -- "$arg"
    first=0
  else
    set -- "$@" "$arg"
  fi
done

if [ "$had_generic" = 0 ]; then
  set -- "$@" -destination "generic/platform=iOS Simulator"
fi

exec "$real" "$@"

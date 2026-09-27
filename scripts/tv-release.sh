#!/usr/bin/env bash
# One command, one release. Stamps every TV module in hub/index.html with a
# single release ID, so the TV always runs one coherent snapshot.
#
#   scripts/tv-release.sh
#
# For each /hub/<module>-rNNN.js referenced by hub/index.html it:
#   1. copies hub/<module>.js (the source) to hub/<module>-r<ID>.js
#   2. rewrites the reference in hub/index.html to the new ID
#   3. checks every stamped file is byte-identical to its source
#   4. stamps FOS_BUILD in hub/index.html and hub/version.json
#   5. deletes older stamped copies of those modules
# Any failure before step 5 restores the original files, so no half-stamped
# release is left behind. The running TV checks /hub/version.json every
# 2 minutes and reloads when it changes.
set -euo pipefail
cd "$(dirname "$0")/.."

INDEX=hub/index.html
ID=$(date -u +%s)
BUILD=$(date -u +%Y%m%d%H%M%S)

MODULES=$(grep -oE '/hub/[a-z0-9-]+-r[0-9]+\.js' "$INDEX" | sed -E 's#/hub/(.+)-r[0-9]+\.js#\1#' | sort -u)
[ -n "$MODULES" ] || { echo "No stamped modules found in $INDEX" >&2; exit 1; }
for m in $MODULES; do
  [ -f "hub/$m.js" ] || { echo "Missing source hub/$m.js" >&2; exit 1; }
done

WORK=$(mktemp -d)
cp "$INDEX" "$WORK/index.html"
cp hub/version.json "$WORK/version.json" 2>/dev/null || true
NEW_FILES=()
rollback() {
  echo "Release failed; restoring previous state." >&2
  cp "$WORK/index.html" "$INDEX"
  [ -f "$WORK/version.json" ] && cp "$WORK/version.json" hub/version.json
  for f in "${NEW_FILES[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  rm -rf "$WORK"
}
trap rollback ERR

for m in $MODULES; do
  out="hub/$m-r$ID.js"
  cp "hub/$m.js" "$out"; NEW_FILES+=("$out")
  sed -i -E "s#/hub/$m-r[0-9]+\.js#/hub/$m-r$ID.js#g" "$INDEX"
done

# Verify: every stamped reference points at this release and matches its source.
refs=$(grep -oE '/hub/[a-z0-9-]+-r[0-9]+\.js' "$INDEX" | sort -u)
for r in $refs; do
  f="${r#/}"
  case "$f" in *-r$ID.js) ;; *) echo "Stale reference left: $r" >&2; false ;; esac
  src="hub/$(basename "$f" | sed -E "s/-r$ID\.js$//").js"
  cmp -s "$f" "$src" || { echo "$f differs from $src" >&2; false; }
done

sed -i "s/var FOS_BUILD = '[^']*'/var FOS_BUILD = '$BUILD'/" "$INDEX"
grep -q "var FOS_BUILD = '$BUILD'" "$INDEX" || { echo "FOS_BUILD not stamped" >&2; false; }
printf '{"build":"%s","release":"r%s"}\n' "$BUILD" "$ID" > hub/version.json

trap - ERR
rm -rf "$WORK"

# Only now remove older stamped copies of the released modules.
removed=0
for m in $MODULES; do
  for old in hub/$m-r[0-9]*.js; do
    [ "$old" = "hub/$m-r$ID.js" ] && continue
    rm -f "$old"; removed=$((removed+1))
  done
done

echo "TV release r$ID (build $BUILD)"
echo "  modules: $(echo $MODULES | tr '\n' ' ')"
echo "  removed $removed old stamped files"

#!/usr/bin/env bash
# Stamp a new TV build. Run this in any commit that changes what the TV loads
# (hub/index.html or any fos-*-rNNN.js it references). The running TV checks
# /hub/version.json every 2 minutes and reloads itself when it changes.
set -e
cd "$(dirname "$0")/.."
V=$(date -u +%Y%m%d%H%M%S)
sed -i "s/var FOS_BUILD = '[^']*'/var FOS_BUILD = '$V'/" hub/index.html
printf '{"build":"%s"}\n' "$V" > hub/version.json
echo "TV build $V"

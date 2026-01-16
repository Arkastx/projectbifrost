#!/usr/bin/env sh
set -euo pipefail

BASE="https://alpha123.github.io/uma-tools/umalator-global"
TARGET="$(cd "$(dirname "$0")/../static/umalator" && pwd)"

mkdir -p "$TARGET"

curl -fsSL "$BASE/bundle.js" -o "$TARGET/bundle.js"
curl -fsSL "$BASE/simulator.worker.js" -o "$TARGET/simulator.worker.js"
curl -fsSL "$BASE/course_data.json" -o "$TARGET/course_data.json"

echo "Umalator assets updated in $TARGET"

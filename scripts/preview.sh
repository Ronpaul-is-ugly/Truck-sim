#!/usr/bin/env bash
# Build a static preview with relative paths (for hosting in a subfolder or as a Claude artifact).
# Writes dist/. The 3D model is also written as base64 text for hosts that don't serve .glb files.
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build --base=./
base64 -w0 dist/models/mx13_engine.glb > dist/models/mx13_engine.glb.b64.txt

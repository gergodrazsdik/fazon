#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Smoke-tests a verifier image (verifier/README.md): renders the visual check's fixtures and a
# page of the generic font families at 1024x768 and a device scale factor of 2, twice, and checks
# that the renders are identical and use the expected fonts. Needs network access in the
# container, to install playwright-core from npm.
# Usage: verifier/smoke/run.sh <image> [<out-dir>]
#   <out-dir> receives the captures and results.json; a new temporary directory by default.
#   CONTAINER_CLI picks the container command (default: docker; podman works too).
set -euo pipefail

image=${1:?usage: verifier/smoke/run.sh <image> [<out-dir>]}
out=${2:-$(mktemp -d)}
cli=${CONTAINER_CLI:-docker}
repo=$(cd "$(dirname "$0")/../.." && pwd)

mkdir -p "$out"
tar -C "$repo" -c \
  verifier/smoke/package.json \
  verifier/smoke/package-lock.json \
  verifier/smoke/render.mjs \
  verifier/smoke/in-image.sh \
  verifier/smoke/fonts.html \
  docs/spec/examples/checks/visual \
  | "$cli" run -i --rm --platform linux/amd64 "$image" \
    bash -c 'mkdir /tmp/smoke && tar -x -C /tmp/smoke && exec bash /tmp/smoke/verifier/smoke/in-image.sh /tmp/smoke' \
  | tar -x -C "$out"

echo "verifier smoke test passed; captures and results.json in $out" >&2

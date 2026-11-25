#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs the rendered checks' fixture tests (vitest.rendered.config.ts) inside the verifier image,
# with its Chromium and fonts: every page in docs/spec/examples/checks/ and in
# packages/core/src/checks/__fixtures__/ through its own check.
#
# The repository is mounted read-only with its installed dependencies (`just install` first), so the
# container needs no network. The dependencies must be installed on linux/amd64, the image's
# platform: Vitest's bundler has native code.
#
# Usage: scripts/test-rendered.sh [<image>]
#   <image> defaults to $FAZON_VERIFIER_IMAGE, then to localhost/fazon-verifier:dev. A localhost/
#   image that doesn't exist yet is built from verifier/; any other is pulled. Prefer the image
#   published from main, by digest: ghcr.io/gergodrazsdik/fazon-verifier@sha256:<digest>.
#   CONTAINER_CLI picks the container command (default: docker; podman works too).
set -euo pipefail

image=${1:-${FAZON_VERIFIER_IMAGE:-localhost/fazon-verifier:dev}}
cli=${CONTAINER_CLI:-docker}
repo=$(cd "$(dirname "$0")/.." && pwd)

if [ ! -d "$repo/node_modules/.pnpm" ]; then
  echo "test-rendered: the dependencies aren't installed; run 'just install' first" >&2
  exit 2
fi

# @fazon/core reads its JSON Schemas from dist/schemas/, which the read-only container can't write.
node "$repo/packages/core/scripts/copy-schemas.ts"

if ! "$cli" image inspect "$image" >/dev/null 2>&1; then
  case "$image" in
    localhost/*)
      echo "test-rendered: building $image from verifier/" >&2
      "$cli" build --platform linux/amd64 --tag "$image" --file "$repo/verifier/Containerfile" "$repo/verifier"
      ;;
    *)
      "$cli" pull --platform linux/amd64 "$image"
      ;;
  esac
fi

# label=disable: the mount needs no SELinux relabelling of the checkout.
"$cli" run --rm --platform linux/amd64 --network none --security-opt label=disable \
  --volume "$repo:/work:ro" --workdir /work "$image" \
  node node_modules/vitest/vitest.mjs run --config vitest.rendered.config.ts --configLoader runner "${@:2}"

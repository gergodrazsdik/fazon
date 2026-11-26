#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs `fazon verify` and `fazon baseline update` end to end (packages/cli/e2e/): a component
# library with the example Button, verified in the verifier image, baselined, verified again, and
# then seeded with one defect per check; and `fazon generate --clean` on a second copy, whose fake
# Claude Code writes the known-good Button back, so the in-image checks of one iteration pass.
#
# The CLI runs on the host and starts the image itself, so this needs the built packages
# (`just build`) and a container runtime. The image is referenced by digest, as fazon.yaml needs:
#
# Usage: scripts/test-verify.sh [<image>]
#   <image> defaults to $FAZON_VERIFIER_IMAGE, then to localhost/fazon-verifier:dev, which is
#   built from verifier/ when it doesn't exist. A tag is turned into the image's digest. With
#   Docker, an image built locally has no digest to run it by: pass a pulled image, such as
#   ghcr.io/gergodrazsdik/fazon-verifier@sha256:<digest>, or use Podman.
#   CONTAINER_CLI picks the container command (default: docker; podman works too); it's passed to
#   fazon as FAZON_CONTAINER_RUNTIME. FAZON_E2E_KEEP=1 keeps the project under .fazon/e2e/.
set -euo pipefail

image=${1:-${FAZON_VERIFIER_IMAGE:-localhost/fazon-verifier:dev}}
cli=${CONTAINER_CLI:-docker}
repo=$(cd "$(dirname "$0")/.." && pwd)

if [ ! -f "$repo/packages/cli/dist/bin.js" ]; then
  echo "test-verify: the packages aren't built; run 'just build' first" >&2
  exit 2
fi

if ! "$cli" image inspect "$image" >/dev/null 2>&1; then
  case "$image" in
    localhost/*)
      echo "test-verify: building $image from verifier/" >&2
      "$cli" build --platform linux/amd64 --tag "$image" --file "$repo/verifier/Containerfile" "$repo/verifier"
      ;;
    *)
      "$cli" pull --platform linux/amd64 "$image"
      ;;
  esac
fi

case "$image" in
  *@sha256:*) reference=$image ;;
  *)
    digest=$("$cli" image inspect --format '{{.Digest}}' "$image" 2>/dev/null || true)
    case "$digest" in
      sha256:*) ;;
      *)
        echo "test-verify: $image has no digest to run it by; with Docker, pass a pulled image by digest" >&2
        exit 2
        ;;
    esac
    reference="${image%:*}@$digest"
    ;;
esac

echo "test-verify: verifying in $reference" >&2
FAZON_E2E_IMAGE=$reference FAZON_CONTAINER_RUNTIME=$cli \
  node "$repo/node_modules/vitest/vitest.mjs" run --config "$repo/packages/cli/e2e/vitest.config.ts" "${@:2}"

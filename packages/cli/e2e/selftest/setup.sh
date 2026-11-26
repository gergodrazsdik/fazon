#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# The install command of the reusable workflow's self-test (.github/workflows/verify-selftest.yml),
# which calls verify.yml with this directory as its working directory. Like a consumer before M5
# (ADR 0022), it builds the framework from source, here from this checkout. It then builds the
# verifier image with Podman, as verify-e2e.yml does, since an image it builds has a digest to pin
# without a registry, and writes the end-to-end test's consumer project (../project.ts) into this
# directory, with that digest in fazon.yaml. `--seed` adds one defect per check, so the workflow
# must fail.
#
# In GitHub Actions it also sets FAZON_CONTAINER_RUNTIME=podman for the job's later steps, as the
# image is in Podman's store. The files it writes are gitignored.
#
# Usage: packages/cli/e2e/selftest/setup.sh [--seed]
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
tag=localhost/fazon-verifier:selftest
cd "$repo"

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  # The exact pnpm version package.json's packageManager names.
  npm install -g "pnpm@$(jq -r '.packageManager | sub("^pnpm@"; "")' package.json)"
fi
pnpm install --frozen-lockfile
pnpm run build

podman build --platform linux/amd64 --build-arg "REVISION=${GITHUB_SHA:-selftest}" \
  --tag "$tag" --file verifier/Containerfile verifier
digest=$(podman image inspect --format '{{.Digest}}' "$tag")
case "$digest" in
  sha256:*) ;;
  *)
    echo "setup: $tag has no digest" >&2
    exit 1
    ;;
esac

node packages/cli/e2e/write-project.ts "$here" "${tag%:*}@$digest" "$@"

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "FAZON_CONTAINER_RUNTIME=podman" >>"$GITHUB_ENV"
fi

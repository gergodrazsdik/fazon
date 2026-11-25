#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Run a command that needs the workspace's dependencies (node_modules) if they are installed;
# otherwise skip with a clear message, as scripts/with-tool.sh does for tools.
# Usage: scripts/with-deps.sh <command> [args...]
#
# Skipping is for local hooks only: CI sets FAZON_REQUIRE_TOOLS=1, which turns missing
# dependencies into a failure.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

if [ -d "$root/node_modules" ] && command -v pnpm >/dev/null 2>&1; then
  exec "$@"
fi

if [ "${FAZON_REQUIRE_TOOLS:-0}" = 1 ]; then
  echo "error: the workspace's dependencies are not installed (required). Run 'just install'." >&2
  exit 127
fi

echo "SKIPPED: the workspace's dependencies are not installed, so this check did not run. Run 'just install'." >&2
exit 0

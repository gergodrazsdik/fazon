#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs inside the verifier image (run.sh starts it): checks that the generic font families resolve
# to the expected fonts, installs playwright-core from the lockfile and runs render.mjs.
# Logs go to stderr; stdout carries a tar archive of the captures and results.json.
# Usage: in-image.sh <root>; <root> holds verifier/smoke/ and docs/spec/examples/checks/visual/.
set -euo pipefail

root=${1:?usage: in-image.sh <root>}
smoke="$root/verifier/smoke"
out=$(mktemp -d)
status=0

{
  for pair in system-ui='DejaVu Sans' sans-serif='DejaVu Sans' serif='DejaVu Serif' monospace='DejaVu Sans Mono'; do
    generic=${pair%%=*}
    expected=${pair#*=}
    actual=$(fc-match --format '%{family[0]}' "$generic")
    echo "fc-match $generic: $actual"
    if [ "$actual" != "$expected" ]; then
      echo "FAIL fc-match $generic gives $actual, expected $expected"
      status=1
    fi
  done

  NPM_CONFIG_UPDATE_NOTIFIER=false npm ci --prefix "$smoke" --ignore-scripts --no-audit --no-fund
  node "$smoke/render.mjs" "$root" "$out" || status=1
} >&2

# The captures go out even when a check failed, so the failure can be looked at.
tar -C "$out" -c .
exit "$status"

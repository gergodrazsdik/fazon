#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Checks that every tracked source file starts with its license identifier, on the first line or
# right after a shebang (AGENTS.md, docs/spec/licensing.md):
#   - files under a templates/ directory, whose text Fazon writes into other repositories: MIT-0;
#   - every other source file: GPL-3.0-or-later.
# Source files are shell scripts, TypeScript, JavaScript, Vue single-file components, CSS and HTML.
#
# Usage: scripts/check-spdx.sh [<file>...]   (default: every tracked source file)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

pattern='\.(sh|bash|ts|mts|cts|tsx|js|mjs|cjs|jsx|vue|css|html)$'
if [[ $# -gt 0 ]]; then
  files=("$@")
else
  mapfile -t files < <(git ls-files)
fi

failed=0
checked=0
for file in "${files[@]}"; do
  [[ $file =~ $pattern ]] || continue
  [[ -f $file ]] || continue
  if [[ $file == templates/* || $file == */templates/* ]]; then
    want=MIT-0
  else
    want=GPL-3.0-or-later
  fi
  head_lines=$(head -n 2 "$file")
  first=${head_lines%%$'\n'*}
  if [[ $first == '#!'* ]]; then
    line=${head_lines#*$'\n'}
  else
    line=$first
  fi
  checked=$((checked + 1))
  if [[ $line != *"SPDX-License-Identifier: $want"* ]]; then
    echo "FAIL $file: expected 'SPDX-License-Identifier: $want' on its first line, or after a shebang" >&2
    failed=1
  fi
done

if [[ $failed == 0 ]]; then
  echo "ok   $checked source files carry their license identifier"
fi
exit "$failed"

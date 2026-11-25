#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Checks that the contributor agreement the CLA assistant shows (a public Gist) is identical to
# CLA.md, the canonical text. Read-only; needs curl and network access to gist.githubusercontent.com.
#
# Usage: scripts/check-cla-gist.sh [<raw-gist-url>]
#   The URL defaults to the Gist the CLA assistant is linked to (FAZON_CLA_GIST_URL overrides it).
#   Exit 0 when identical, 1 when they differ (with a diff), 2 when the Gist can't be read.
#
# When CLA.md changes, update the Gist after the pull request is merged, not before: contributors
# sign what the Gist shows, and the CLA assistant asks them to sign again after it changes.
set -eu

default_url=https://gist.githubusercontent.com/gergodrazsdik/b48a98cb3fcc8634131b115dc84095ad/raw/fazon-cla.md
url=${1:-${FAZON_CLA_GIST_URL:-$default_url}}
root=$(cd "$(dirname "$0")/.." && pwd)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! curl -fsSL --retry 3 -o "$tmp/gist" "$url"; then
  echo "error: could not read the Gist at $url" >&2
  exit 2
fi

# Compared without trailing newlines at the end: the Gist editor drops the file's final newline.
printf '%s\n' "$(cat "$root/CLA.md")" >"$tmp/repo.md"
printf '%s\n' "$(cat "$tmp/gist")" >"$tmp/gist.md"

if cmp -s "$tmp/repo.md" "$tmp/gist.md"; then
  echo "ok: the Gist is identical to CLA.md"
  exit 0
fi

echo "DIFFERENT: the Gist ($url) doesn't match CLA.md. Lines starting with '-' are CLA.md's, '+' the Gist's:" >&2
diff -u "$tmp/repo.md" "$tmp/gist.md" | sed '1,2d' >&2 || true
cat >&2 <<'EOF'

Copy CLA.md from main into the Gist, as the whole file. If CLA.md changed in a pull request that
isn't merged yet, wait for the merge.
EOF
exit 1

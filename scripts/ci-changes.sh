#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Decides which CI jobs a change needs, from the files it changes, and prints them as GitHub
# Actions outputs:
#   code=true       unless every changed file is Markdown outside docs/spec/examples/ (the example
#                   specs there are test inputs); `build` runs only for code=true
#   workflows=true  when anything under .github/ changed; `zizmor` runs only for workflows=true
# Without a base commit (a push to main), everything is needed: both print true.
#
# Usage: scripts/ci-changes.sh [<base-sha> <head-sha>]   (both from the pull request event)
set -euo pipefail

base=${1:-}
head=${2:-}

if [[ -z $base || -z $head ]]; then
  printf 'code=true\nworkflows=true\n'
  exit 0
fi

mapfile -t files < <(git diff --name-only "$base" "$head")

code=false
workflows=false
for file in "${files[@]}"; do
  case $file in
    .github/*) workflows=true ;;
  esac
  case $file in
    docs/spec/examples/*) code=true ;;
    *.md) ;;
    *) code=true ;;
  esac
done

# An empty diff decides nothing; run everything rather than skip on a surprise.
if [[ ${#files[@]} -eq 0 ]]; then
  code=true
  workflows=true
fi

printf 'code=%s\nworkflows=%s\n' "$code" "$workflows"

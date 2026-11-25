#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Checks the JSON Schemas under docs/spec/schemas/ and their examples (docs/spec/spec-format.md,
# docs/spec/story-matrix.md, docs/spec/baseline-lifecycle.md, docs/spec/judge.md, docs/spec/records.md,
# docs/spec/config.md, docs/spec/cli.md):
#   - every schema is valid against its metaschema;
#   - every spec under valid/ and invalid/semantic/ passes the schema (a semantic example breaks
#     a rule only `fazon spec check` sees, from M2);
#   - every spec under invalid/schema/ fails it, at the path its `# expect-error-at:` line names;
#   - every manifest under docs/spec/examples/manifests/ passes the story manifest schema;
#   - the examples of the baselines record, the judge plan and result, the run record, provenance
#     and the calibration record pass their schemas;
#   - the CLI output examples pass the CLI output schema;
#   - the config examples (YAML) pass the config and local-override schemas, and the local schema's
#     definitions are the same as the config schema's.
# Needs yq (mikefarah, v4) to read front matter and YAML, check-jsonschema, and jq.
#
# Usage: scripts/check-spec-examples.sh
#
# A missing tool skips the check with a message, as scripts/with-tool.sh does; CI sets
# FAZON_REQUIRE_TOOLS=1, which turns a missing tool into a failure.
set -euo pipefail
shopt -s nullglob

root=$(cd "$(dirname "$0")/.." && pwd)
schema="$root/docs/spec/schemas/spec.schema.json"
manifest_schema="$root/docs/spec/schemas/story-manifest.schema.json"
baselines_schema="$root/docs/spec/schemas/baselines.schema.json"
plan_schema="$root/docs/spec/schemas/judge-plan.schema.json"
result_schema="$root/docs/spec/schemas/judge-result.schema.json"
run_schema="$root/docs/spec/schemas/run-record.schema.json"
provenance_schema="$root/docs/spec/schemas/provenance.schema.json"
calibration_schema="$root/docs/spec/schemas/calibration-record.schema.json"
config_schema="$root/docs/spec/schemas/config.schema.json"
local_schema="$root/docs/spec/schemas/config-local.schema.json"
cli_schema="$root/docs/spec/schemas/cli-output.schema.json"
examples="$root/docs/spec/examples/specs"
manifests="$root/docs/spec/examples/manifests"

for tool in yq check-jsonschema jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    if [[ ${FAZON_REQUIRE_TOOLS:-0} == 1 ]]; then
      echo "error: $tool is not installed (required). Run 'just doctor' for install hints." >&2
      exit 127
    fi
    echo "SKIPPED: $tool is not installed, so the spec examples were not checked. Run 'just doctor' for install hints." >&2
    exit 0
  fi
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The front matter of <spec.md> as JSON, written to <out.json>.
front_matter() { # <spec.md> <out.json>
  if [[ $(head -n 1 "$1") != "---" ]]; then
    echo "error: $1 has no front matter" >&2
    return 1
  fi
  yq --front-matter=extract -o=json '.' "$1" >"$2"
}

check() { # <json>...: check-jsonschema against the spec schema
  check-jsonschema --schemafile "$schema" "$@"
}

failed=0
check-jsonschema --check-metaschema "$schema" "$manifest_schema" "$baselines_schema" "$plan_schema" "$result_schema" \
  "$run_schema" "$provenance_schema" "$calibration_schema" "$config_schema" "$local_schema" \
  "$cli_schema" || failed=1

# Must pass.
for spec in "$examples"/valid/*.md "$examples"/invalid/semantic/*.md; do
  json="$tmp/$(basename "$spec" .md).json"
  rel=${spec#"$root"/}
  out=""
  if ! front_matter "$spec" "$json" || ! out=$(check "$json" 2>&1); then
    echo "FAIL $rel: expected to pass the schema" >&2
    [[ -n $out ]] && echo "$out" >&2
    failed=1
  else
    echo "ok   $rel passes"
  fi
done

# Must fail, at the expected path.
for spec in "$examples"/invalid/schema/*.md; do
  json="$tmp/$(basename "$spec" .md).json"
  rel=${spec#"$root"/}
  expect=$(sed -nE 's/^# expect-error-at: (.+)$/\1/p' "$spec" | head -n 1)
  if [[ -z $expect ]]; then
    echo "FAIL $rel: no '# expect-error-at:' line" >&2
    failed=1
    continue
  fi
  if ! front_matter "$spec" "$json"; then
    failed=1
    continue
  fi
  if out=$(check "$json" 2>&1); then
    echo "FAIL $rel: expected to fail the schema at $expect, but it passes" >&2
    failed=1
  elif ! grep -qF -- "::$expect:" <<<"$out"; then
    echo "FAIL $rel: expected an error at $expect, got:" >&2
    echo "$out" >&2
    failed=1
  else
    echo "ok   $rel fails at $expect"
  fi
done

# Manifests must pass their schema.
for manifest in "$manifests"/*.json; do
  rel=${manifest#"$root"/}
  if ! out=$(check-jsonschema --schemafile "$manifest_schema" "$manifest" 2>&1); then
    echo "FAIL $rel: expected to pass the story manifest schema" >&2
    echo "$out" >&2
    failed=1
  else
    echo "ok   $rel passes"
  fi
done

# Single examples must pass their schemas.
expect_pass() { # <schema> <json>...
  local schema_file=$1 file
  shift
  for file in "$@"; do
    if ! out=$(check-jsonschema --schemafile "$schema_file" "$file" 2>&1); then
      echo "FAIL ${file#"$root"/}: expected to pass ${schema_file#"$root"/}" >&2
      echo "$out" >&2
      failed=1
    else
      echo "ok   ${file#"$root"/} passes"
    fi
  done
}
expect_pass "$baselines_schema" "$root/docs/spec/examples/baselines/fazon.json"
expect_pass "$plan_schema" "$root"/docs/spec/examples/judge/*-plan.json
expect_pass "$result_schema" "$root"/docs/spec/examples/judge/*-result.json
expect_pass "$run_schema" "$root/docs/spec/examples/records/run.json"
expect_pass "$provenance_schema" "$root/docs/spec/examples/records/provenance.json"
expect_pass "$calibration_schema" "$root"/docs/spec/examples/records/calibration-*.json
expect_pass "$cli_schema" "$root"/docs/spec/examples/cli/*.json

# YAML examples: converted to JSON, then checked.
for config in "$root"/docs/spec/examples/config/*/fazon.yaml "$root"/docs/spec/examples/config/*/fazon.local.yaml; do
  json="$tmp/config-$(basename "$(dirname "$config")")-$(basename "$config" .yaml).json"
  yq -o=json '.' "$config" >"$json"
  case $config in
    *.local.yaml) schema_file=$local_schema ;;
    *) schema_file=$config_schema ;;
  esac
  if ! out=$(check-jsonschema --schemafile "$schema_file" "$json" 2>&1); then
    echo "FAIL ${config#"$root"/}: expected to pass ${schema_file#"$root"/}" >&2
    echo "$out" >&2
    failed=1
  else
    echo "ok   ${config#"$root"/} passes"
  fi
done

# The local schema repeats some of the config schema's definitions; they must not drift.
# shellcheck disable=SC2016  # $defs is a JSON key for jq, not a shell variable
shared='.["$defs"] | {model, loop, models, effort, effortLevel}'
if [[ "$(jq -S "$shared" "$config_schema")" != "$(jq -S "$shared" "$local_schema")" ]]; then
  echo "FAIL ${local_schema#"$root"/}: its definitions differ from ${config_schema#"$root"/}" >&2
  failed=1
else
  echo "ok   ${local_schema#"$root"/} matches ${config_schema#"$root"/}"
fi

exit "$failed"

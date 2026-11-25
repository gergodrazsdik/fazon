# Fazon repo tasks. `just` lists the recipes.
# On Windows, run recipes from Git Bash or WSL (they use sh).

import? 'local.just'

# List the recipes
default:
    @just --list --unsorted

# Check that the required tools are installed and print install hints
[group('meta')]
doctor:
    #!/bin/sh
    missing=0
    check() {
      if command -v "$1" >/dev/null 2>&1; then
        printf '  ok       %s\n' "$1"
      else
        printf '  MISSING  %-22s %s\n' "$1" "$2"
        missing=1
      fi
    }
    optional() {
      if command -v "$1" >/dev/null 2>&1; then
        printf '  ok       %s\n' "$1"
      else
        printf '  -        %-22s %s\n' "$1" "$2"
      fi
    }
    echo "Required:"
    check git                  "https://git-scm.com/downloads"
    check just                 "https://just.systems/man/en/packages.html"
    check lefthook             "https://lefthook.dev/installation/"
    check markdownlint-cli2    "npm install -g markdownlint-cli2"
    check yamllint             "pipx install yamllint (or uv tool install yamllint)"
    check actionlint           "https://github.com/rhysd/actionlint/blob/main/docs/install.md"
    check zizmor               "pipx install zizmor (or uv tool install zizmor), https://docs.zizmor.sh/installation/"
    check pinact               "https://github.com/suzuki-shunsuke/pinact#install"
    check typos                "cargo install typos-cli, or https://github.com/crate-ci/typos#install"
    check editorconfig-checker "https://github.com/editorconfig-checker/editorconfig-checker#installation"
    check shellcheck           "https://github.com/koalaman/shellcheck#installing"
    check hadolint             "https://github.com/hadolint/hadolint#install"
    check gitleaks             "https://github.com/gitleaks/gitleaks#installing"
    check yq                   "https://github.com/mikefarah/yq#install (mikefarah yq v4, not the Python yq)"
    check check-jsonschema     "pipx install check-jsonschema (or uv tool install check-jsonschema)"
    check jq                   "https://jqlang.org/download/"
    echo "Recommended:"
    optional gh                "https://cli.github.com/"
    optional claude            "https://code.claude.com/docs/en/setup"
    echo "The code (packages/):"
    check node                 "Node.js 26 (.node-version): https://nodejs.org/en/download, or fnm/nvm"
    check pnpm                 "the version in package.json's packageManager: corepack enable pnpm, or npm install -g pnpm@<version>"
    optional podman            "Podman or Docker for the verifier image: https://podman.io/docs/installation"
    echo "Git hooks:"
    if [ -f "$(git rev-parse --git-path hooks)/commit-msg" ]; then
      echo "  ok       installed"
    else
      echo "  MISSING  git hooks              just hooks"
      missing=1
    fi
    exit "$missing"

# Which pinned linter versions have newer releases, and when each update is due (7-day cooldown); read-only
[group('meta')]
tool-updates:
    scripts/tool-updates.sh

# Install the git hooks (lefthook)
[group('dev')]
hooks:
    lefthook install

# Install the workspace's dependencies from the lockfile (pnpm)
[group('dev')]
install:
    pnpm install --frozen-lockfile

# Build the packages (tsc)
[group('dev')]
build:
    pnpm run build

# Run the framework's tests (Vitest)
[group('dev')]
test:
    pnpm test

# Everything CI checks: the linters, the TypeScript lint and format check, the build and the tests
[group('dev')]
check: lint lint-ts build test

# Start Claude Code in this repo, with the example repo in reach when it's cloned next to it (extra arguments are passed through)
[group('dev')]
claude *args:
    #!/bin/sh
    if [ -d ../fazon-vue-example ]; then
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 exec claude --add-dir ../fazon-vue-example {{ args }}
    fi
    exec claude {{ args }}

# Run every linter (the lint workflow's lint job)
[group('lint')]
lint: lint-md lint-yaml lint-actions zizmor pinact-check lint-sh lint-container typos editorconfig gitleaks spec-examples spdx

# Lint Markdown (markdownlint-cli2)
[group('lint')]
lint-md:
    git ls-files -z '*.md' | xargs -0 scripts/with-tool.sh markdownlint-cli2

# Lint YAML (yamllint)
[group('lint')]
lint-yaml:
    scripts/with-tool.sh yamllint --strict .

# Lint GitHub Actions workflows (actionlint)
[group('lint')]
lint-actions:
    scripts/with-tool.sh actionlint

# Audit GitHub Actions workflows for security problems (zizmor, offline audits)
[group('lint')]
zizmor:
    scripts/with-tool.sh zizmor --offline --no-progress .github/workflows

# Check that every action is pinned to a full commit SHA (pinact)
[group('lint')]
pinact-check:
    scripts/with-tool.sh pinact run --check

# Lint shell scripts (shellcheck)
[group('lint')]
lint-sh:
    git ls-files -z '*.sh' | xargs -0 scripts/with-tool.sh shellcheck

# Lint the container files (hadolint)
[group('lint')]
lint-container:
    git ls-files -z '*Containerfile' '*Dockerfile' | xargs -0 -r scripts/with-tool.sh hadolint

# Check spelling (typos)
[group('lint')]
typos:
    scripts/with-tool.sh typos

# Check files against .editorconfig (editorconfig-checker)
[group('lint')]
editorconfig:
    git ls-files -z | xargs -0 scripts/with-tool.sh editorconfig-checker

# Scan the git history for secrets (gitleaks)
[group('lint')]
gitleaks:
    scripts/with-tool.sh gitleaks git --redact --no-banner

# Check the spec schema and validate the spec examples against it (yq, check-jsonschema)
[group('lint')]
spec-examples:
    scripts/check-spec-examples.sh

# Check that every source file starts with its license identifier (SPDX)
[group('lint')]
spdx:
    scripts/check-spdx.sh

# Lint and format-check the TypeScript code (ESLint, Prettier); needs `just install`
[group('lint')]
lint-ts:
    pnpm run lint
    pnpm run format:check

# Pin workflow actions to full commit SHAs (pinact)
[group('lint')]
pin:
    pinact run

# Apply the repository settings and rulesets to <owner/repo> (--no-required-checks on a new repo)
[group('maintainer')]
github-settings repo *flags:
    scripts/github-settings.sh {{ flags }} {{ repo }}

# Check that the CLA assistant's Gist is identical to CLA.md (the cla-gist workflow runs it too)
[group('maintainer')]
cla-gist-check:
    scripts/check-cla-gist.sh

# Read the repository settings of <owner/repo> back and report differences
[group('maintainer')]
github-settings-check repo:
    scripts/github-settings.sh --check {{ repo }}

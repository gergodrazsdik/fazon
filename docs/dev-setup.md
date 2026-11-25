# Development setup

What you need to work on Fazon, and how to check it.

## Prerequisites

### Every contribution

| Tool | Version | Install |
|---|---|---|
| Git | 2.40 or newer | <https://git-scm.com/downloads> |
| just | 1.59 or newer | <https://just.systems/man/en/packages.html> |
| lefthook | 2.x | <https://lefthook.dev/installation/> |
| markdownlint-cli2 | 0.24 | `npm install -g markdownlint-cli2` (needs Node.js) |
| yamllint | 1.38 | `pipx install yamllint` or `uv tool install yamllint` |
| actionlint | 1.7 | <https://github.com/rhysd/actionlint/blob/main/docs/install.md> |
| zizmor | 1.32 | `pipx install zizmor` or `uv tool install zizmor`, <https://docs.zizmor.sh/installation/> |
| pinact | 5.x | <https://github.com/suzuki-shunsuke/pinact#install> |
| typos | 1.52 | <https://github.com/crate-ci/typos#install> |
| editorconfig-checker | 4.x | <https://github.com/editorconfig-checker/editorconfig-checker#installation> |
| ShellCheck | 0.11 | <https://github.com/koalaman/shellcheck#installing> |
| hadolint | 2.15 | <https://github.com/hadolint/hadolint#install> |
| gitleaks | 8.30 | <https://github.com/gitleaks/gitleaks#installing> |
| yq (mikefarah) | 4.54 | <https://github.com/mikefarah/yq#install> (not the Python `yq`) |
| check-jsonschema | 0.39 | `pipx install check-jsonschema` or `uv tool install check-jsonschema` |
| jq | 1.7 or newer | <https://jqlang.org/download/> |

CI runs the versions pinned in `.github/workflows/lint.yml` and `scripts/install-ci-tools.sh`. Recommended: the [GitHub CLI](https://cli.github.com/) (`gh`) and [Claude Code](https://code.claude.com/docs/en/setup).

### The code

| Tool | Version | Install |
|---|---|---|
| Node.js | 26, the current LTS (`.node-version`) | <https://nodejs.org/en/download>, or a version manager such as fnm or nvm |
| pnpm | the version in `package.json`'s `packageManager` | `corepack enable pnpm`, or `npm install -g pnpm@<that version>` |
| Docker or Podman | a current release | <https://docs.docker.com/get-docker/>, <https://podman.io/docs/installation> |

`pnpm install` takes only releases at least 7 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`, the same cooldown as Dependabot's), and runs no dependency's install scripts unless `pnpm-workspace.yaml` lists it.

The verifier image runs every rendered check in a container, so a laptop and CI agree on every screenshot. Docker and rootless Podman both work; with Podman, tools that expect Docker may need Podman's Docker-compatible socket.

## First steps

```sh
git clone https://github.com/gergodrazsdik/fazon.git
cd fazon
just doctor   # what's installed, with install hints
just hooks    # install the git hooks
just install  # the workspace's dependencies, from the lockfile
just check    # the checks CI runs: linters, ESLint, Prettier, build, tests
```

`just test-rendered` runs the rendered checks' fixtures in the verifier image, with its Chromium and fonts. It builds `localhost/fazon-verifier:dev` from `verifier/` when that image doesn't exist; `just test-rendered <image>` uses another, such as the image published from `main`, by digest. The container mounts the checkout read-only with its installed dependencies, so run `just install` first, on linux/amd64. Set `CONTAINER_CLI=podman` when `docker` isn't available.

The Vue adapter's browser integration tests run the generated contract tests in Vitest's browser mode and build a Storybook, so they need Chromium and stay out of `just check`:

```sh
pnpm --filter @fazon/adapter-vue exec playwright install chromium  # once: Playwright 1.65.1's Chromium
just test-browser
```

## WSL notes

- Keep the clone in the Linux file system (for example `~/projects/fazon`), not under `/mnt/c`: file watching and git are much faster there, and line endings stay LF.
- Install the tools inside the Linux distribution, not on the Windows side.
- With Docker Desktop, turn on its WSL integration for your distribution; or use Podman inside WSL.

## Optional: signed commits

Signing is welcome but not required. GitHub shows a signed commit as "Verified" once your public key is on your account:

- [Generating a new GPG key](https://docs.github.com/en/authentication/managing-commit-signature-verification/generating-a-new-gpg-key) or [signing with an SSH key](https://docs.github.com/en/authentication/managing-commit-signature-verification/telling-git-about-your-signing-key#telling-git-about-your-ssh-key)
- Then `git config commit.gpgSign true` (and for SSH keys `git config gpg.format ssh` and `git config user.signingKey <path to your public key>`).

## Local secrets

Fazon never stores or ships credentials. From M2 on, generation and the vision judge need a model API key, which they read from an environment variable (`ANTHROPIC_API_KEY`); the exact variables are listed in the config file reference once it is written.

- Export the key in your shell, or put it in `.env.local` (gitignored) if a tool reads it.
- To keep it out of files altogether, read it from your own secret manager at run time in a personal recipe in `local.just` (gitignored); `local.just.example` shows the pattern.
- Never commit a key, and never paste one into an issue or a log.

## Working with Claude Code

`just claude` starts Claude Code in the repo, and adds `../fazon-vue-example` with its instructions when the example repo is cloned next to this one. The committed `.claude/settings.json` turns on the Bash sandbox with a network allowlist and denies reading secrets; [CLAUDE.md](../CLAUDE.md) says what has to run outside it.

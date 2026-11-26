# Agent instructions: Fazon

These instructions are for coding agents (Claude Code, Codex and others) working in this repo. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md).

## What Fazon is

A framework that lets a coding agent build UI components from written specs and verifies each one by rendering it, running deterministic checks and asking a vision model to judge what the checks cannot measure. It ships a CLI harness, agent skills, a verifier container image and a reusable CI workflow. Its first consumer is a separate repository, `fazon-vue-example`, with a 17-component Vue 3 library ([ADR 0020](docs/adr/0020-component-list-and-npm-names.md)).

Where the truth lives:

- [docs/design/brief.md](docs/design/brief.md): scope, architecture, milestones and the starting decisions. Read the relevant sections before any non-trivial work. It is complete, and the lint gates cover it like any other file. Don't edit it on your own, not even to make a check pass: it changes only through a pull request the maintainer makes or asks for.
- [docs/adr/](docs/adr/README.md): decisions that refine or supersede the brief.
- [docs/spec/](docs/spec/README.md): the M0 documents, as they are merged.
- [docs/plan/TRACKER.md](docs/plan/TRACKER.md): what's open and next.

If the brief conflicts with an ADR, a spec, these instructions or a request, stop and raise it with the maintainer; don't pick a side yourself.

**Current phase: M1, the walking skeleton.** The M0 documents in [docs/spec/README.md](docs/spec/README.md) are the contract the code implements; a change to one is a pull request that updates the document with its schemas and examples. The steps are T-0046's subtasks in the [tracker](docs/plan/TRACKER.md).

## Layout

```text
AGENTS.md CLAUDE.md README.md LICENSE CLA.md CHANGELOG.md
CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md SUPPORT.md
justfile  local.just.example  lefthook.yml  .editorconfig  lint configs
package.json  pnpm-workspace.yaml  pnpm-lock.yaml  .node-version  tsconfig*.json  eslint.config.js  vitest.config.ts  .prettierrc.json
LICENSES/                MIT-0.txt: the license of template text Fazon writes into other repositories
packages/                cli/ (the `fazon` package), core/ (`@fazon/core`), adapter-vue/ (`@fazon/adapter-vue`)
verifier/                the verifier image: Containerfile, fonts, smoke test (verifier/README.md)
.claude/settings.json    committed Claude Code sandbox and deny rules
.github/                 workflows/ (lint.yml, ci.yml, verifier.yml, rendered.yml, cla-gist.yml), rulesets/, issue and PR templates, CODEOWNERS, dependabot.yml
docs/design/brief.md     the design brief (complete; changes only when the maintainer asks)
docs/adr/                architecture decision records
docs/plan/TRACKER.md     work tracker
docs/spec/               the M0 documents and their index; schemas/ and examples/ beside them, example-library/ drafts
docs/dev-setup.md        prerequisites and local setup
scripts/                 with-tool.sh, with-deps.sh, check-commit-msg.sh, github-settings.sh, install-ci-tools.sh, tool-updates.sh, check-cla-gist.sh, check-spec-examples.sh, check-spdx.sh, test-rendered.sh, ci-changes.sh
```

Directories arrive with the milestone that first needs them (`packages/`, `plugin/`, `verifier/` from M1; see the brief's "Framework repo layout"). Keep this tree current when you add top-level folders.

## Working agreement

- Work on feature branches (`feat/…`, `fix/…`, `docs/…`, `ci/…`, `chore/…`). **Never commit to `main`.**
- Push branches and open pull requests with `gh`. The description follows the PR template: summary, tracker IDs, checks run. It becomes the commit body when the maintainer squash-merges, so keep it clean.
- **Never merge a pull request, never enable auto-merge on one, and never create, move or delete a tag.** The maintainer does those.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `build:`, `test:`…) for commits and pull request titles; a squash merge uses the title as the commit header. Small, logical commits.
- Write commit messages to a file outside the repo and commit with `git commit -F <file>`. Signing is welcome; if your git config signs, keep it on.
- Every source file starts with `SPDX-License-Identifier: GPL-3.0-or-later` as a comment, on the first line or after a shebang. Template files, whose text Fazon writes into an adopter's repository, carry `SPDX-License-Identifier: MIT-0` instead, and the files written from them carry no header ([license terms](docs/spec/licensing.md), [ADR 0003](docs/adr/0003-bootstrap-answers.md)).
- Never bypass a hook (`--no-verify`), never weaken or skip a check, and never relax a lint rule to get a change through. Fix the cause, or raise it.
- Ask before any GitHub write other than pushing your branch and creating or editing your pull requests: comments, reviews, closing, labels, settings, force pushes outside your own stack.

## Stacked PRs

When one change builds on another that isn't merged yet, open the pull requests as a native GitHub stack with the `gh stack` extension ([about stacked PRs](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs), [commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)), not as pull requests based on each other's branches. GitHub then retargets the rest of the stack when one merges.

- Create the branches with `gh stack init <branch>…` (or `gh stack add <branch>` on the top branch), and commit to each as usual.
- Publish with `gh stack submit --auto --open` (without `--auto` it opens an interactive editor), then give each pull request its real title and body with `gh pr edit --title … --body-file <file>`.
- The maintainer merges the stack bottom-up, in the GitHub UI or with `gh`. Afterwards, `gh stack sync --prune` updates trunk and the remaining branches locally and deletes the merged ones.
- `sync` and `rebase` may force-push the stack's own branches (with lease). `link`, `merge` and `unstack` write to GitHub: ask first. Never run `gh stack merge`.

## Commands

Use `just` (`just --list`):

| Recipe | What it does |
|---|---|
| `just doctor` | Check the tools; prints install hints. |
| `just hooks` | Install the lefthook git hooks. |
| `just lint` | Every linter the `lint` workflow runs: Markdown, YAML, actionlint, zizmor, pinact, shellcheck, hadolint, typos, EditorConfig, gitleaks, the spec examples against their schema, and the license identifiers. |
| `just install` | Install the workspace's dependencies from the lockfile (pnpm). |
| `just build` / `just test` | Build the packages (`tsc --build`); run the framework's tests (Vitest). |
| `just lint-ts` | ESLint and the Prettier check on the TypeScript code. |
| `just check` | Everything CI checks: `lint`, `lint-ts`, `build` and `test`. |
| `just test-browser` | The Vue adapter's browser tests: the generated contract tests and the Storybook build in Playwright's Chromium (install it once: `pnpm --filter @fazon/adapter-vue exec playwright install chromium`). |
| `just test-rendered [image]` | The rendered checks' fixtures in the verifier image (podman or docker, `CONTAINER_CLI`); the `rendered` workflow runs them in CI. |
| `just pin` | Pin workflow actions to full commit SHAs. |
| `just tool-updates` | Which linter versions pinned outside Dependabot's reach have newer releases, and when each is due (7-day cooldown). Read-only. |
| `just claude` | Start Claude Code in this repo, with the example repo (`../fazon-vue-example`) and its instructions in reach when it's cloned next to this one. |
| `just github-settings <repo>` / `just github-settings-check <repo>` | Maintainer only. Apply or check the repository settings and rulesets. |
| `just cla-gist-check` | Check that the CLA assistant's Gist is identical to `CLA.md`. After a pull request changes `CLA.md`, the maintainer updates the Gist once it is merged. |

Run `just check` before every commit (`just lint` alone when no code changed). The hooks run the linters, ESLint and Prettier on staged files, plus gitleaks and the Conventional Commits header. `verify` arrives with the verifier.

## Design principles

From the brief; every spec and every line of code follows them.

- **Deterministic checks before the judge.** Anything measurable is checked by a deterministic tool. The vision model judges only what cannot be measured, and it is advisory until its calibration meets the thresholds.
- **A person at three decision points:** the component's API before code is written, the local review of the result, and the pull request. Nothing automates them away.
- **The harness owns the loop.** The agent only edits the files it is allowed to; the harness decides what runs next, enforces the caps and records every step. A check is never relaxed to get a run through; only an explicit exemption in the spec waives one.
- **A framework-neutral core.** The core never imports framework code; everything framework-specific sits behind an adapter. Don't call Fazon framework-neutral in public until a second adapter exists.
- **Nothing machine-specific in committed files:** no absolute paths, hostnames, usernames, secret-manager entries or credentials. Fazon never ships, stores or proxies credentials.

## Work tracker

[docs/plan/TRACKER.md](docs/plan/TRACKER.md) is the single tracker. Rules:

- IDs are never reused: `T-NNNN` tasks, `F-NNNN` findings, `Q-NNNN` questions. Take the next one from "Next free IDs" at the top, and update it.
- Update the tracker **in the same pull request** as the work it tracks.
- Keep items short: a title, then the date and commit or PR link once done. Details belong in the PR description.
- A task that takes more than one pull request gets indented subtasks, each with its own status, date and link; the task's status follows them.
- Finished items stay in place, ticked, with date and link. Dropped items (`[-]`) keep a one-line reason. When a phase completes, add a one-line summary under its heading.
- Plan from **Now**, in order. Propose before starting anything larger than one pull request. Ask the maintainer about `[!]` items.
- New findings and questions go into the tracker immediately, not only into chat.
- Decisions don't live in the tracker: they are ADRs.
- Don't add a "last updated" line: git has that.

## Decisions (ADRs)

A decision is recorded as an ADR in [docs/adr/](docs/adr/README.md), in the pull request that makes it, using the template there. Accepted ADRs aren't rewritten; a new one supersedes them. A choice that changes the brief, an ADR or a spec's contract needs the maintainer's approval first.

## When something is unknown

Don't guess on scope, behaviour, licensing or anything the brief leaves open. Record a question (`Q-NNNN`) in the tracker, ask the maintainer, and carry on with work that doesn't depend on the answer.

## Local overrides

`local.just`, `lefthook-local.yml`, `CLAUDE.local.md`, `.claude/settings.local.json` and `.env.local` are personal and gitignored. Never commit them, and never put machine-specific paths, tools or secret-manager commands into committed files.

## Writing style

Precise, concise, plain English. No marketing language. Docs say what something does and when to use it. Specs say what must hold, in testable terms.

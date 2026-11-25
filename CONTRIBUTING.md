# Contributing to Fazon

Thanks for your interest. Fazon has one maintainer, so the process is light. Two rules are strict: outside contributions need a signed Contributor License Agreement before they can be merged, and nothing personal or machine-specific goes into the repo.

> Fazon is in its specification phase (milestone M0): the work is documents under `docs/spec/`, not code. Scope and milestones are in the [design brief](docs/design/brief.md), decisions in [docs/adr/](docs/adr/README.md), what's planned in [docs/plan/TRACKER.md](docs/plan/TRACKER.md), and what changed in [CHANGELOG.md](CHANGELOG.md).

## Proposing changes

- **Small fixes** (typos, broken links, an obvious mistake): open a pull request directly.
- **Anything non-trivial** (a feature, a dependency, a change to a spec or to the process): open an issue first and agree on the approach, so nobody's work is wasted. Check the tracker, the ADRs and the brief: it may already be planned or decided.
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Branches and pull requests

- Never commit to `main`. Work on a branch (`feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `ci/<topic>`…) in your fork or, for maintainers, in the repo.
- Open a pull request using the template: summary, tracker IDs, the checks you ran.
- The maintainer merges by **squash** or **rebase**. A squash merge uses the pull request's title and description as the commit on `main`; a rebase merge lands your commits as they are. Keep the branch up to date with `main` (the "Update branch" button, or `git rebase main` and `git push --force-with-lease` to your branch).
- Keep commits small and logical; each one should pass `just lint`. Squash `fixup!` commits before review is done.
- A change people would notice adds a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md), in the same pull request ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/): Added, Changed, Deprecated, Removed, Fixed, Security).
- **Stacked changes:** maintainers and agents use the [`gh stack`](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs) extension for pull requests that build on each other. Without it, open ordinary pull requests and say in the description which one yours builds on.

## Commit messages and pull request titles

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[(scope)][!]: <summary>`, with type one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`. Examples:

```text
docs(spec): describe the story matrix rules
feat(cli): add fazon spec check
ci: pin the verifier image by digest
```

Pull request titles follow the same format, because a squash merge uses the title as the commit header. The `commit-msg` hook checks each commit header as you commit; the `pr-title` check checks the title, and warns about commit headers that a rebase merge would bring to `main`.

## Signing

Signed commits and tags are welcome but not required: GitHub's own merges must keep working. To sign, see [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification) and [docs/dev-setup.md](docs/dev-setup.md#optional-signed-commits).

## Contributor License Agreement

Before an outside contribution can be merged, its author signs the [Contributor License Agreement](CLA.md) (the Harmony individual agreement). You keep the copyright in your contribution; the agreement lets the maintainer also license it under other terms, commercial ones included ([ADR 0002](docs/adr/0002-contributor-license-agreement.md)). The CLA assistant asks you to sign on your first pull request; you sign once with your GitHub account. If you contribute as part of your job, your employer may have rights in your work: have them approve the agreement first (Section 3(c)).

The agreement is still being reviewed: until it is in force, no outside pull request is merged.

### Third-party material

The agreement covers only work you own. If your contribution includes material you don't own the copyright in (code, text or images by someone else, or generated output whose terms you are bound by):

- say so in the pull request description: what the material is, where it comes from, who holds the copyright and under which license you received it;
- keep its copyright and license notices intact;
- submit it only if its license is compatible with GPL-3.0-or-later.

The maintainer decides whether such material can be included.

## Local setup

See [docs/dev-setup.md](docs/dev-setup.md) for prerequisites. Then:

```sh
just doctor   # check tools, with install hints
just hooks    # install the git hooks (pre-commit and commit-msg)
just lint     # run the linters CI runs
```

`just lint` and the hooks skip a check whose tool is missing and print a clear message; CI sets `FAZON_REQUIRE_TOOLS=1` and runs every check.

### Local overrides

These files are personal and gitignored. Put anything machine-specific or secret-related there, never in committed files:

| File | Purpose |
|---|---|
| `local.just` | Extra recipes, imported by the justfile if present (see `local.just.example`). |
| `lefthook-local.yml` | Personal hook overrides ([lefthook docs](https://lefthook.dev/configuration/)). |
| `CLAUDE.local.md` | Personal notes for Claude Code. |
| `.claude/settings.local.json` | Personal Claude Code settings. |
| `.env.local` | Local environment variables. |

## What goes in the repo

Committed files never contain personal or machine-specific data: no absolute paths, hostnames, usernames, secret-manager entries or credentials. Fazon never ships, stores or proxies credentials; every adopter brings their own.

Every source file starts with the license identifier as a comment, on the first line or right after a shebang:

```text
SPDX-License-Identifier: GPL-3.0-or-later
```

## Workflow approvals

Workflows from outside contributors need the maintainer's approval before they run. That is a GitHub setting for every external contributor, not a judgement on you.

## AI-assisted contributions

Contributions written with AI coding agents are welcome; much of this project is built that way. You are responsible for every line you submit: review it, understand it, test it. The Contributor License Agreement covers AI-assisted contributions exactly like any other. Agent instructions for this repo are in [AGENTS.md](AGENTS.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

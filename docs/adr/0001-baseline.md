# 0001: Baseline decisions from the design brief

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0004

## Context and problem statement

The [design brief](../design/brief.md) settles Fazon's scope, structure and process before any code is written. Its [Decided](../design/brief.md#decided) table is the starting list. Later ADRs refine or supersede these decisions one by one, and they need a recorded starting point.

## Considered options

1. One grouped baseline ADR that summarizes the brief's decisions and links to their reasoning.
2. One ADR per decision.
3. No ADR; treat the brief as the record.

## Decision outcome

Chosen option: "one grouped baseline ADR", because the brief already holds the reasoning, and later ADRs need something they can supersede piece by piece.

The baseline:

- **Name and repositories** ([Repositories and deliverables](../design/brief.md#repositories-and-deliverables)): Fazon, with `fazon` as the command. Two repositories: `fazon` for the framework (CLI harness, adapters, agent skills, verifier image, reusable workflow) and `fazon-vue-example` for the example library, its first consumer. A consumer references the framework by version and never copies it.
- **License and contributions** ([Licensing](../design/brief.md#licensing)): the framework is GPL-3.0-or-later, copyright Gergő Drazsdik. Outside contributors sign a contributor license agreement so the project can be relicensed; there is no DCO. The agreement itself is [ADR 0002](0002-contributor-license-agreement.md). The license of what Fazon writes into an adopter's repo is settled in M0.
- **Merging** ([Conventions in both repos](../design/brief.md#conventions-in-both-repos)): changes reach `main` through pull requests only, merged by squash or rebase. The maintainer merges; no second approval is required. Signing is encouraged but not required, so GitHub's own merges keep working.
- **Deterministic checks first, the judge second** ([Summary](../design/brief.md#summary), [Verification](../design/brief.md#verification)): deterministic tools check everything that can be measured; a vision model judges only what cannot. The judge is advisory until its calibration meets the thresholds, and it is called directly through the API with an API key for now. A person decides at three points: the API, the local review and the pull request.
- **Framework-neutral core** ([Framework adapters](../design/brief.md#framework-adapters)): the core never imports framework code; everything framework-specific sits behind an adapter. Version 1 ships the Vue adapter only. Fazon calls itself framework-neutral in public only once a second adapter exists.
- **Tooling** ([Tech stack and repo conventions](../design/brief.md#tech-stack-and-repo-conventions)): a Node CLI in TypeScript for adopters, in a pnpm workspace; `just` for repo tasks, with gitignored local recipes; lefthook for git hooks.
- **Styling** ([Framework adapters](../design/brief.md#framework-adapters)): plain CSS with custom properties in version 1. Tailwind follows after version 1.
- **Token values** ([Tokens](../design/brief.md#tokens)): the agent proposes a small neutral token set for the example library and the maintainer approves it once.
- **Publishing** ([Summary](../design/brief.md#summary)): whether to publish the packages and promote the project is decided after version 1 (M0 to M5). The repositories, the container image and GitHub releases are public during development, and that does not count as publishing.

### Consequences

- Changing a baseline decision needs the maintainer's approval and a superseding ADR.
- The brief stays the place for detail and reasoning; ADRs link to it rather than copying it. The brief changes only through a pull request.

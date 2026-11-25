# Fazon work tracker

What's open and next. Agents keep it current; humans skim it. Rules are in [AGENTS.md](../../AGENTS.md#work-tracker); decisions are in the [ADRs](../adr/README.md), not here. Scope and milestones come from the [brief](../design/brief.md#milestones).

Legend: [ ] todo · [~] in progress · [x] done · [-] dropped · [!] blocked or needs a decision

Next free IDs: T-0088, F-0007, Q-0019.

## Now

<!-- the next 3–5 items, in order; agents pick work from here -->

1. M1: the maintainer creates the `fazon` npm organisation and reserves the scoped names (T-0087), then the example repo (T-0040) and the first package (T-0041); break down the walking skeleton (T-0046) at M1's start
2. Tool updates as they come due: zizmor 1.33.1 from 2026-11-29 (T-0084)

## Phase 0: Bootstrap

### Repository and skeleton

- [x] T-0001 Create the empty public GitHub repository and initialise `~/projects/fazon` in place — 2026-11-25, [ebad2ad](https://github.com/gergodrazsdik/fazon/commit/ebad2ad)
- [x] T-0002 Skeleton: license, Code of Conduct, contributing, security and support files, changelog, editor and lint configs, `justfile`, lefthook hooks, `scripts/` — 2026-11-25, [ebad2ad](https://github.com/gergodrazsdik/fazon/commit/ebad2ad)
- [x] T-0003 Agent instructions: `AGENTS.md`, `CLAUDE.md`, committed `.claude/settings.json` — 2026-11-25, [ebad2ad](https://github.com/gergodrazsdik/fazon/commit/ebad2ad)
- [x] T-0004 Work tracker, ADR template and the baseline ADR (0001) — 2026-11-25, [ebad2ad](https://github.com/gergodrazsdik/fazon/commit/ebad2ad)
- [x] T-0005 `lint` workflow (`lint`, `zizmor`, `pr-title` jobs) and Dependabot for GitHub Actions — 2026-11-25, [ebad2ad](https://github.com/gergodrazsdik/fazon/commit/ebad2ad)
- [x] T-0006 Repository settings and rulesets (`scripts/github-settings.sh`), applied and checked — 2026-11-25, applied with `--no-required-checks` after the first push; `just github-settings-check` reports every setting as matching
- [x] T-0007 Smoke-test pull request: `lint`, `zizmor` and `pr-title` run and pass, then they become required checks on `main` — 2026-11-25, [#1](https://github.com/gergodrazsdik/fazon/pull/1)
- [x] T-0008 Contributor agreement text: Harmony HA-CLA-I 1.0 with outbound Option Five in `CLA.md` ([ADR 0002](../adr/0002-contributor-license-agreement.md)) — 2026-11-25, [ebad2ad](https://github.com/gergodrazsdik/fazon/commit/ebad2ad)
- [x] T-0009 The maintainer merges the smoke-test pull request with "Rebase and merge", to confirm the relaxed rules work (maintainer) — 2026-11-25, [#1](https://github.com/gergodrazsdik/fazon/pull/1): the rebase merge went through with no required signatures; GitHub rewrote the commits, so they are unsigned on `main`
- [x] T-0015 CI tool pins: the linter versions in `scripts/install-ci-tools.sh` and `.github/workflows/lint.yml` are outside Dependabot's reach; bump them together with the local toolchain (`just doctor`), with a 7-day cooldown like Dependabot's — 2026-11-25: `just tool-updates` (`scripts/tool-updates.sh`) reports each pin, the local version and the newest release, and when each update is due; the updates themselves are T-0084
- [ ] T-0084 Tool updates as they come due: `just tool-updates` says which, and each is a pull request that changes the version (and for release binaries the URL and digest) in `scripts/install-ci-tools.sh` or `.github/workflows/lint.yml`, together with the local install
  - [ ] zizmor 1.33.1 from 2026-11-29: `ZIZMOR_VERSION` and the zizmor action's `version` input together; the action itself (v0.9.x) comes through Dependabot
- [x] T-0082 Reserve the npm name `fazon` with a placeholder package, version `0.0.0`, no code ([ADR 0003](../adr/0003-bootstrap-answers.md)); the maintainer publishes it with their own npm account (steps in the pull request) — 2026-11-25: `fazon@0.0.0` is `latest` on npm, published by the maintainer (F-0004)

### Contributor agreement (before the first outside contribution)

- [x] T-0010 Review `CLA.md` under Hungarian law (its Section 6.1) and drop the draft notice — 2026-11-25: a best-effort review without a lawyer, its findings accepted by the maintainer and applied ([ADR 0004](../adr/0004-contributor-agreement-amended.md), Q-0017)
  - Review input, 2026-11-25: a non-lawyer review the maintainer obtained. Its citations of the Copyright Act (Szjt.) 9. § (2), 30. § (1), 44. § (1), 45. § (1)–(2), 52. § and 60. § (5) were checked against the official text on njt.jog.gov.hu; the Civil Code citation (Ptk. 6:78. §), the appeal-court ruling and the reading of "distribute" were not. Points for the lawyer:
    - [x] Future contributions, the main risk: Szjt. 44. § (1) voids a licence clause for an unspecified number of the author's future works, and 60. § (5) doesn't exempt software from it; a sign-once agreement for every later pull request, across "more than one software project", resembles that. Under 52. §, a contract for future works defined by type can be terminated every five years, and the author can't waive that, so "irrevocable" may not hold for them. Suggested direction: each Submission is itself the grant for that Contribution (repeated in the PR template), and the agreement covers Fazon only — applied: Section 2.7 makes each Submission its own grant, the agreement covers Fazon only, and the PR template repeats it
    - [x] Section 2.4's waiver of moral rights has no effect: Szjt. 9. § (2) says the author can neither transfer nor waive them, so commercially licensed builds still owe contributors their attribution — applied: Section 2.4 adds that the contributor keeps what can't be waived, with their authorship kept in the version history
    - [x] Non-code "Media": the written-form exemption (Szjt. 45. § (2) c)) covers software only; whether a click counts as written form for images, icons or design assets is unsettled — applied: Section 2.8 licenses Media to everyone under CC BY 4.0, a public offer that needs no written form (Szjt. 45. § (2) d), checked)
    - [x] Scope of use: name the uses explicitly, including making the Contribution available to the public online, since a licence without named uses is read narrowly — applied: Section 2.1(b) adds making the Contribution available to the public, including online
    - [x] Unusual standard terms (Ptk. 6:78. §, not checked): show the commercial relicensing note to the contributor at signing, not only the agreement text — applied: the CLA assistant shows the whole file, with the note on commercial relicensing (T-0011)
    - [x] Section 3(c): it points to an "Entity version" that doesn't exist yet (the corporate agreement is deferred); work made as an employment duty belongs to the employer (Szjt. 30. § (1)); the CLA assistant can't take a parent's signature, so a minimum age of 18 may be simpler — applied: no Entity version or guardian's signature in 3(c), a new 3(e) on the minimum age of 18, employer ownership explained in CONTRIBUTING.md
    - [-] Governing law covers the contract, not copyright itself: a foreign contributor's home-country author protections can still apply — no wording can change that; recorded in [ADR 0004](../adr/0004-contributor-agreement-amended.md)
- [x] T-0011 Install the CLA assistant GitHub App on the repository, link the agreement (a Gist made from the whole of `CLA.md`, its notes included) and exempt the maintainer and `dependabot[bot]` (maintainer; steps in the bootstrap pull request) — 2026-11-25: installed and linked to the public [Gist](https://gist.github.com/gergodrazsdik/b48a98cb3fcc8634131b115dc84095ad)
- [x] T-0012 Keep `CLA.md` and the CLA assistant's Gist identical: compare them with every change to either — 2026-11-25: automated; `just cla-gist-check` (`scripts/check-cla-gist.sh`) compares them, and the `cla-gist` workflow runs it on pushes to `main` that change `CLA.md`, weekly and on demand. Not a required check: the Gist is updated after the merge
  - Checked 2026-11-25: the Gist is identical to `CLA.md` on `main` except for the final newline, which the Gist editor drops (the first check said byte-for-byte identical: `gh api --jq` had added the newline). The check ignores trailing newlines
- [x] T-0013 Test pull request: the CLA assistant reports `license/cla`; check whether a `Co-Authored-By` trailer (agent commits) asks the co-author to sign, and exempt that address if so — 2026-11-25, [#5](https://github.com/gergodrazsdik/fazon/pull/5): `license/cla` reported "All CLA requirements met."; the `Co-Authored-By` trailer asked nobody to sign, so no further exemption is needed
- [x] T-0014 Make `license/cla` a required check after T-0013, in its own ruleset with an admin bypass, so a CLA assistant outage (F-0002) doesn't block every merge — 2026-11-25, [#5](https://github.com/gergodrazsdik/fazon/pull/5): the `cla` ruleset (`.github/rulesets/cla.json`), pinned to the CLA assistant's app (ID 128106) once it posted as the app (F-0005)

## Phase 1: Specification (M0)

Done when every document is merged through a pull request the maintainer reviewed, and the repo holds documents, schemas and example data but no executable product code. Index: [docs/spec/README.md](../spec/README.md).

Complete 2026-11-25: fifteen documents at version 0, with their schemas, examples and ADRs 0005 to 0019, and every M0 question settled ([ADR 0020](../adr/0020-component-list-and-npm-names.md)).

- [x] T-0020 Spec format and its JSON Schema, including fixtures, multi-part components and exemptions (Q-0005, Q-0006) — 2026-11-25: format version 0, with valid and invalid examples checked by `just lint` ([ADR 0005](../adr/0005-spec-format.md)), [#8](https://github.com/gergodrazsdik/fazon/pull/8)
- [x] T-0021 Story matrix rules, including the icon set that spec fixtures draw from — 2026-11-25: version 0, with the story manifest schema and the example specs' manifests ([ADR 0006](../adr/0006-story-matrix.md)), [#10](https://github.com/gergodrazsdik/fazon/pull/10)
- [x] T-0022 Check catalogue, with one rule sheet per check — 2026-11-25: version 0, with HTML fixtures for the rendered checks ([ADR 0007](../adr/0007-check-catalogue.md)), [#11](https://github.com/gergodrazsdik/fazon/pull/11)
- [x] T-0023 Baseline lifecycle — 2026-11-25: version 0, with the baselines record's schema ([ADR 0008](../adr/0008-baseline-lifecycle.md)), [#13](https://github.com/gergodrazsdik/fazon/pull/13)
- [x] T-0024 Agent permission model — 2026-11-25: version 0 ([ADR 0009](../adr/0009-agent-permissions.md)), [#14](https://github.com/gergodrazsdik/fazon/pull/14)
- [x] T-0025 Loop and caps: defaults, enforcement, and what an iteration is — 2026-11-25: version 0 ([ADR 0010](../adr/0010-loop-and-caps.md)), [#16](https://github.com/gergodrazsdik/fazon/pull/16)
- [x] T-0026 Judge: rubric, image batching and the CI cost cap — 2026-11-25: version 0, with the judge plan and result schemas ([ADR 0011](../adr/0011-judge.md)), [#17](https://github.com/gergodrazsdik/fazon/pull/17)
- [x] T-0027 Measurement protocol, including judge calibration and its thresholds; count linked feedback runs together and report models per iteration ([ADR 0010](../adr/0010-loop-and-caps.md)); when a judge model counts as calibrated for a framework version, its stability and cost ([ADR 0011](../adr/0011-judge.md)) — 2026-11-25: version 0 ([ADR 0012](../adr/0012-measurement.md)), [#18](https://github.com/gergodrazsdik/fazon/pull/18)
- [x] T-0028 Run record and provenance schemas, including the calibration record and the fields measured runs need ([ADR 0012](../adr/0012-measurement.md)) (Q-0012) — 2026-11-25: version 0, with schemas and examples ([ADR 0013](../adr/0013-records.md)), [#20](https://github.com/gergodrazsdik/fazon/pull/20)
- [x] T-0029 Config file reference: name, format and keys, including a consumer's own fixture icon set ([ADR 0006](../adr/0006-story-matrix.md)) the baselines directory ([ADR 0008](../adr/0008-baseline-lifecycle.md)) the components directory ([ADR 0009](../adr/0009-agent-permissions.md)), the caps, models, escalation threshold, effort and judge prices ([ADR 0010](../adr/0010-loop-and-caps.md)), and the judge's model, policy, CI cap and repeats ([ADR 0011](../adr/0011-judge.md)) — 2026-11-25: version 0, with the config and local override schemas ([ADR 0014](../adr/0014-config.md)), [#21](https://github.com/gergodrazsdik/fazon/pull/21)
- [x] T-0030 CLI reference, covering every command, including `fazon baseline update` ([ADR 0008](../adr/0008-baseline-lifecycle.md)) and reading and pruning `.fazon/` ([ADR 0013](../adr/0013-records.md)); `fazon init` writes `fazon.yaml` and gitignores `fazon.local.yaml` and `.fazon/`, and an upgrade command updates `image` ([ADR 0014](../adr/0014-config.md)) — 2026-11-25: version 0, with the JSON output schema ([ADR 0015](../adr/0015-cli.md)), [#22](https://github.com/gergodrazsdik/fazon/pull/22)
- [x] T-0031 Adapter boundary, including how the example repo consumes the framework before M5, the source checks' and self-checks' commands, the file patterns allowed in a component's directory, and reading a component's API for the contract tests (Q-0001) — 2026-11-25: version 0 ([ADR 0016](../adr/0016-adapter-boundary.md)), [#23](https://github.com/gergodrazsdik/fazon/pull/23)
- [x] T-0032 Reusable workflow interface: inputs, secrets and permissions; it compares baselines and lists those a pull request changes, and never writes them ([ADR 0008](../adr/0008-baseline-lifecycle.md)); the judge step's secret, fork skipping and cap ([ADR 0011](../adr/0011-judge.md)); it uploads the report but no transcript ([ADR 0013](../adr/0013-records.md)) — 2026-11-25: version 0, with the caller workflow `init` writes ([ADR 0017](../adr/0017-workflow.md)), [#25](https://github.com/gergodrazsdik/fazon/pull/25)
- [x] T-0033 Conventions doc and token set, with its themes, for the example library: drafts that move to the example repo at M1; the maintainer approves the token values once; align the placeholder token names in the spec examples; the conventions doc requires the `data-part` and `data-<state>` attributes ([ADR 0006](../adr/0006-story-matrix.md)); say which tokens are role tokens, how custom properties are named, and the story frame's base styles ([ADR 0007](../adr/0007-check-catalogue.md)) (Q-0007) — 2026-11-25: the token set spec, version 0, with token file and resolver schemas, and the example library's drafts ([ADR 0018](../adr/0018-token-set.md)), [#26](https://github.com/gergodrazsdik/fazon/pull/26)
- [x] T-0034 License terms for generated and scaffolded files, and for the example repo, and the license notices of Lucide (the fixture icons) and Inter (the example library's font, SIL OFL 1.1, [ADR 0018](../adr/0018-token-set.md)) (Q-0002, Q-0003, Q-0004) — 2026-11-25: version 0, with `LICENSES/MIT-0.txt` and the example library's license, notices and contributing drafts ([ADR 0019](../adr/0019-license-terms.md)), [#27](https://github.com/gergodrazsdik/fazon/pull/27)

## Phase 2: Foundation (M1 to M3)

### M1 Walking skeleton

- [ ] T-0040 Create `gergodrazsdik/fazon-vue-example` (public, at `~/projects/fazon-vue-example`) with the same conventions and settings script; MIT-0, no CLA assistant, and the license, notices and contributing drafts from `docs/spec/example-library/` ([ADR 0019](../adr/0019-license-terms.md))
- [ ] T-0041 The first package: pnpm workspace, `.node-version` and `packageManager` pins
- [ ] T-0042 Dependabot: add the `npm` ecosystem with the first package
- [ ] T-0043 CodeQL default setup: add `javascript-typescript` once code exists (`scripts/github-settings.sh`)
- [ ] T-0044 Sandbox network allowlist for Playwright and Storybook (browser downloads, registries), and any MCP servers, in `.claude/settings.json`
- [ ] T-0045 `just build`, `just test` and `just verify` recipes, with the code
- [ ] T-0046 The walking skeleton: one hand-written Button, story generation from its spec, the verifier image, `verify` with the source and rendered checks, baselines, the CI workflow; a laptop and CI give the same verdict, and one seeded failure per check fails the build; measure the visual tolerance by repeated renders and confirm the `focus` action; the framework's CI pushes pre-release verifier images to GHCR, a lint rule keeps framework code out of the core, and the example repo checks its three pins name one commit ([ADR 0016](../adr/0016-adapter-boundary.md)); the reusable `verify.yml` with its `verify`, `judge` and `comment` jobs ([ADR 0017](../adr/0017-workflow.md)) ([ADR 0006](../adr/0006-story-matrix.md), [ADR 0007](../adr/0007-check-catalogue.md)) (break down at M1 start)
- [ ] T-0085 The tokens pipeline: resolve the resolver document, run Style Dictionary once per theme with references kept (its warning about references the dark block filters out is expected), and build `paths.tokensCss` in `fazon sync`; pin Style Dictionary and `@fontsource-variable/inter`; move the drafts in `docs/spec/example-library/` to the example repo ([ADR 0018](../adr/0018-token-set.md))
- [ ] T-0087 Create the `fazon` npm organisation and reserve `@fazon/core` and `@fazon/adapter-vue` with placeholder packages, version `0.0.0`, no code, as for `fazon` (T-0082); the maintainer publishes them with their own npm account, before M1's first package ([ADR 0020](../adr/0020-component-list-and-npm-names.md))
- [ ] T-0083 A lint check that every source file carries the `SPDX-License-Identifier: GPL-3.0-or-later` header, and template files `MIT-0`, with the first TypeScript code ([ADR 0003](../adr/0003-bootstrap-answers.md), [ADR 0019](../adr/0019-license-terms.md))

### M2 The loop

- [ ] T-0050 `spec new`, `spec check`, the spec skill, `propose`, `generate`, caps, run records, the HTML report; Badge, Link and Dialog generated from specs with no hand edits, and Button regenerated the same way (break down at M2 start)

### M3 Vision judge

- [ ] T-0055 Judge call, rubric from the spec, seeded-defect set, calibration, the judge in the local loop, advisory CI step; catch rate and false-positive rate measured against the thresholds
- [ ] T-0056 The workflows' first secret: the judge's API key, skipped on pull requests from forks

## Phase 3: Library and packaging (M4 and M5)

### M4 The library

- [ ] T-0060 The remaining 13 components, the packed library as a CI artifact, the docs site, the second calibration; 17 components pass, Menu and Popover included ([ADR 0020](../adr/0020-component-list-and-npm-names.md)), and the metrics table is on the site
- [ ] T-0061 GitHub Pages for the docs site: the first deploy job and its `pages: write` permission, as the reusable `pages.yml` ([ADR 0017](../adr/0017-workflow.md))

### M5 Packaging (end of version 1)

- [ ] T-0065 The plugin, npm packages attached to a GitHub release, the signed image, the versioned workflow, `fazon init`; a fresh repo adopts the framework from the README alone
- [ ] T-0066 Write permissions for image and release publishing (packages, attestations, releases), and the actions those workflows use in the allowed-actions list; pre-release image pushes already have `packages: write` from M1, signing starts here ([ADR 0016](../adr/0016-adapter-boundary.md))

## Phase 4: Results

- [ ] T-0070 M6: an article with the measured results
- [ ] T-0071 The publishing decision: publish and promote Fazon as an open-source tool, or keep it as a reference project
- [ ] T-0072 Turn on GitHub Discussions, with the publishing decision
- [ ] T-0086 With the publishing decision: whether the example repo takes outside contributions, and under which terms ([ADR 0019](../adr/0019-license-terms.md))

## Later

- [ ] T-0080 Further adapters: Angular, then React, Svelte and Web Components
- [ ] T-0081 Tailwind as a second styling option

## Deferred

From the brief's [Deferred](../design/brief.md#deferred) table:

- Publishing to npm and promoting the project: after version 1 (T-0071)
- Tailwind support and further framework adapters: after version 1 (T-0080, T-0081)
- A second vendor's model as the judge: after version 1
- A corporate contributor agreement (Harmony HA-CLA-E): before the first contribution from a company
- Whether the local judge can run without an API key: after M3

## Findings

<!-- problems found along the way; ID F-NNNN -->

- [x] F-0001 The brief was committed as exported and excluded from the Markdown and spelling gates rather than edited. With the repo's configs it failed one rule: markdownlint MD040 (the "Framework repo layout" code block had no language) (maintainer, 2026-11-25) — fixed 2026-11-25: the brief is complete and won't be exported again, so the maintainer asked for the fix; the block is tagged `text` and the brief is no longer excluded from any gate
- [x] F-0002 The hosted CLA assistant had several outages of 2 to 9 hours in October 2026; a required `license/cla` check with no bypass would block every merge during one (2026-11-25, T-0014) — closed 2026-11-25: the `cla` ruleset's admin bypass covers an outage (T-0014)

- [x] F-0003 The first `lint` run on `main` failed: editorconfig-checker v4's archive holds the binary as `editorconfig-checker`, not `ec-linux-amd64`; the installer's one-match check caught it — fixed 2026-11-25, in the smoke-test pull request
- [ ] F-0004 Publishing to npm has changed, which matters for M5 (T-0065, T-0066): the first publish of a new package also makes npm create a public `0.0.0-stage` placeholder version (staged publishing, which new packages joined in October 2026), and npm is restricting tokens that bypass 2FA for direct publishing. Release publishing from CI should plan for trusted publishing and staged approval (2026-11-25)
- [x] F-0005 The CLA assistant first posted `license/cla` on #5 with the maintainer's OAuth token, not as its GitHub App, so the `cla` ruleset couldn't pin the check to the app (ID 128106) (2026-11-25) — the maintainer installed the app, which needs no migration step: from 01:06 UTC its statuses come from `cla-assistant[bot]`, and the ruleset now pins the check to the app ([#5](https://github.com/gergodrazsdik/fazon/pull/5)); the next commit's status came only from the app. The OAuth access stays: signing in to the CLA assistant's dashboard, where the Gist and the exemptions are configured, needs it, and with the pin an OAuth-posted status no longer counts
- [ ] F-0006 Spec format version 0 can't express a `many` part inside another `many` part, such as option groups in Select; revisit when Select is specified (2026-11-25, T-0020)

## Open questions

<!-- questions for the maintainer; ID Q-NNNN -->

From the brief's [Open](../design/brief.md#open) table:

- [x] Q-0001 How does the example repo consume the framework before M5? Proposal: pinned to one framework commit. Settled by M0 (T-0031) — answered 2026-11-25: git dependencies at one commit SHA, the workflow by the same SHA, and the verifier image pushed to GHCR by the framework's CI for that commit, pinned by digest ([ADR 0016](../adr/0016-adapter-boundary.md))
- [x] Q-0002 Which license covers what Fazon writes into an adopter's repo? Proposal: MIT-0 for all of it. Settled by M0 (T-0034) — answered 2026-11-25: MIT-0 for all of it, with no license header on written files; the templates themselves are MIT-0 ([ADR 0019](../adr/0019-license-terms.md))
- [x] Q-0003 Which license does the example repo carry? Proposal: the same permissive license. Settled by M0 (T-0034) — answered 2026-11-25: MIT-0 ([ADR 0019](../adr/0019-license-terms.md))
- [x] Q-0004 Does the CLA apply to the example repo? Proposal: it takes no outside contributions before the publishing decision. Settled by M0 (T-0034) — answered 2026-11-25: no outside contributions before the publishing decision, and no CLA assistant there; the decision revisits it (T-0086, [ADR 0019](../adr/0019-license-terms.md))
- [x] Q-0005 Is the API in a spec framework-neutral, or written per framework? Proposal: neutral, mapped by the adapter. Settled by M0 (T-0020) — direction from the maintainer, 2026-11-25: framework-neutral wherever it maps cleanly, with framework-specific extensions for what doesn't, their reason optional; the extension shape is in the spec format ([ADR 0005](../adr/0005-spec-format.md))
- [x] Q-0006 One spec or several for a multi-part component? Proposal: one spec with named parts. Settled by M0 (T-0020) — answered 2026-11-25, from a worked Tabs example of both options: one spec with named parts ([ADR 0005](../adr/0005-spec-format.md))
- [x] Q-0007 Which part of the token format does the build support? Proposal: the subset the build tool handles today. Settled by M0 (T-0033) — answered 2026-11-25: what Style Dictionary 5.8.0 built in a trial of the draft set (sRGB colours, `px`/`rem` dimensions, `ms` durations, cubic Béziers, font families and weights, numbers, shadows); the resolver document, which it can't read yet, is resolved by Fazon's pipeline ([ADR 0018](../adr/0018-token-set.md))
- [x] Q-0008 Is the list of 15 components right? Proposal: the list under Milestones. Settled by M0 — answered 2026-11-25: the 15, plus Menu and Popover as composites on Reka UI: 17 components ([ADR 0020](../adr/0020-component-list-and-npm-names.md))
- [x] Q-0009 Are baselines kept in git or in Git LFS? Proposal: in git. Settled by M1 — answered 2026-11-25: plain git, losslessly optimised ([ADR 0008](../adr/0008-baseline-lifecycle.md))
- [ ] Q-0010 What is the budget for the measured API runs? Not set. Settled by M2
- [ ] Q-0011 Does the tokens' CSS ship inside the component package or as a package of its own? Proposal: inside the component package. Settled by M1

From the bootstrap:

- [x] Q-0012 Where do run records and reports go? `.gitignore` holds the placeholder `.fazon/` until the run record document settles it (T-0028) — answered 2026-11-25: `.fazon/`, as in `.gitignore`; the run record document defines the layout inside (T-0028, [ADR 0003](../adr/0003-bootstrap-answers.md))
- [x] Q-0013 Do source files carry a license header (for example an `SPDX-License-Identifier: GPL-3.0-or-later` line)? Decide before the first source file (M1) — answered 2026-11-25: yes, an `SPDX-License-Identifier: GPL-3.0-or-later` line, but not in files written into an adopter's repo; the scripts have it, the check comes with the code (T-0083, [ADR 0003](../adr/0003-bootstrap-answers.md))
- [x] Q-0014 Reserve the npm name `fazon` now (free on 2026-11-25) with a placeholder package, or wait for the publishing decision? Publishing anything is the maintainer's call — answered 2026-11-25: yes, reserve it (T-0082, [ADR 0003](../adr/0003-bootstrap-answers.md))
- [x] Q-0015 The contributor agreement's governing law (`CLA.md`, Section 6.1) is blank (maintainer, at the review: T-0010) — answered 2026-11-25: Hungary, filled in ([ADR 0003](../adr/0003-bootstrap-answers.md))
- [x] Q-0016 Confirm the agreement's other fill-ins at the review: the maintainer personally as "We"; CC BY 4.0, CC BY-SA 4.0 and CC0 1.0 as the media licenses; "[or Your Affiliates]" left out of the patent license (maintainer, T-0010) — answered 2026-11-25: confirmed by the maintainer; the legal review still checks them (T-0010, [ADR 0003](../adr/0003-bootstrap-answers.md))
- [x] Q-0017 How is the contributor agreement's review completed: by a lawyer, working from the review input under T-0010, or does the maintainer accept a revised text without one? Either way the maintainer or the lawyer supplies the revised wording (maintainer, 2026-11-25) — answered 2026-11-25: without a lawyer; the maintainer accepts the findings as best effort ([ADR 0004](../adr/0004-contributor-agreement-amended.md))
- [x] Q-0018 Which npm names do the Vue adapter and any core package take, beyond the reserved `fazon`? A scope such as `@fazon/` needs its npm organisation; unscoped names such as `fazon-adapter-vue` don't. Settle before M1's first package, and reserve them as `fazon` was (T-0031, [ADR 0016](../adr/0016-adapter-boundary.md)) — answered 2026-11-25: `fazon` for the CLI, `@fazon/core` and `@fazon/adapter-vue`, under the `fazon` npm organisation; later adapters `@fazon/adapter-<name>` (T-0087, [ADR 0020](../adr/0020-component-list-and-npm-names.md))

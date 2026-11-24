# Fazon work tracker

What's open and next. Agents keep it current; humans skim it. Rules are in [AGENTS.md](../../AGENTS.md#work-tracker); decisions are in the [ADRs](../adr/README.md), not here. Scope and milestones come from the [brief](../design/brief.md#milestones).

Legend: [ ] todo · [~] in progress · [x] done · [-] dropped · [!] blocked or needs a decision

Next free IDs: T-0082, F-0004, Q-0017.

## Now

<!-- the next 3–5 items, in order; agents pick work from here -->

1. The maintainer merges the smoke-test pull request with "Rebase and merge" (T-0009)
2. Contributor agreement: review it and set up the CLA assistant before any outside pull request is merged (T-0010, T-0011)
3. M0: the spec format and its JSON Schema first, as most other documents build on it (T-0020), then the story matrix rules (T-0021) and the check catalogue (T-0022)
4. Decide whether to reserve the npm name `fazon` now (Q-0014)

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
- [!] T-0009 The maintainer merges the smoke-test pull request with "Rebase and merge", to confirm the relaxed rules work (maintainer)
- [ ] T-0015 CI tool pins: the linter versions in `scripts/install-ci-tools.sh` and `.github/workflows/lint.yml` are outside Dependabot's reach; bump them together with the local toolchain (`just doctor`), with a 7-day cooldown like Dependabot's

### Contributor agreement (before the first outside contribution)

- [!] T-0010 Have `CLA.md` reviewed by a lawyer of the maintainer's choice; settle its open blanks (Q-0015, Q-0016), then drop the draft notice (maintainer)
- [!] T-0011 Install the CLA assistant GitHub App on the repository, link the agreement (a Gist made from `CLA.md`) and exempt the maintainer and `dependabot[bot]` (maintainer; steps in the bootstrap pull request)
- [ ] T-0012 Keep `CLA.md` and the CLA assistant's Gist identical: compare them with every change to either
- [ ] T-0013 Test pull request: the CLA assistant reports `license/cla`; check whether a `Co-Authored-By` trailer (agent commits) asks the co-author to sign, and exempt that address if so
- [ ] T-0014 Make `license/cla` a required check after T-0013, in its own ruleset with an admin bypass, so a CLA assistant outage (F-0002) doesn't block every merge

## Phase 1: Specification (M0)

Done when every document is merged through a pull request the maintainer reviewed, and the repo holds documents, schemas and example data but no executable product code. Index: [docs/spec/README.md](../spec/README.md).

- [ ] T-0020 Spec format and its JSON Schema, including fixtures, multi-part components and exemptions (Q-0005, Q-0006)
- [ ] T-0021 Story matrix rules
- [ ] T-0022 Check catalogue, with one rule sheet per check
- [ ] T-0023 Baseline lifecycle
- [ ] T-0024 Agent permission model
- [ ] T-0025 Loop and caps: defaults, enforcement, and what an iteration is
- [ ] T-0026 Judge: rubric, image batching and the CI cost cap
- [ ] T-0027 Measurement protocol, including judge calibration and its thresholds
- [ ] T-0028 Run record and provenance schemas (Q-0012)
- [ ] T-0029 Config file reference: name, format and keys
- [ ] T-0030 CLI reference, covering every command
- [ ] T-0031 Adapter boundary, including how the example repo consumes the framework before M5 (Q-0001)
- [ ] T-0032 Reusable workflow interface: inputs, secrets and permissions
- [ ] T-0033 Conventions doc and token set, with its themes, for the example library: drafts that move to the example repo at M1; the maintainer approves the token values once (Q-0007)
- [ ] T-0034 License terms for generated and scaffolded files, and for the example repo (Q-0002, Q-0003, Q-0004)

## Phase 2: Foundation (M1 to M3)

### M1 Walking skeleton

- [ ] T-0040 Create `gergodrazsdik/fazon-vue-example` (public, at `~/projects/fazon-vue-example`) with the same conventions and settings script
- [ ] T-0041 The first package: pnpm workspace, `.node-version` and `packageManager` pins
- [ ] T-0042 Dependabot: add the `npm` ecosystem with the first package
- [ ] T-0043 CodeQL default setup: add `javascript-typescript` once code exists (`scripts/github-settings.sh`)
- [ ] T-0044 Sandbox network allowlist for Playwright and Storybook (browser downloads, registries), and any MCP servers, in `.claude/settings.json`
- [ ] T-0045 `just build`, `just test` and `just verify` recipes, with the code
- [ ] T-0046 The walking skeleton: one hand-written Button, story generation from its spec, the verifier image, `verify` with the source and rendered checks, baselines, the CI workflow; a laptop and CI give the same verdict, and one seeded failure per check fails the build (break down at M1 start)

### M2 The loop

- [ ] T-0050 `spec new`, `spec check`, the spec skill, `propose`, `generate`, caps, run records, the HTML report; Badge, Link and Dialog generated from specs with no hand edits, and Button regenerated the same way (break down at M2 start)

### M3 Vision judge

- [ ] T-0055 Judge call, rubric from the spec, seeded-defect set, calibration, the judge in the local loop, advisory CI step; catch rate and false-positive rate measured against the thresholds
- [ ] T-0056 The workflows' first secret: the judge's API key, skipped on pull requests from forks

## Phase 3: Library and packaging (M4 and M5)

### M4 The library

- [ ] T-0060 The remaining 11 components, the packed library as a CI artifact, the docs site, the second calibration; 15 components pass and the metrics table is on the site
- [ ] T-0061 GitHub Pages for the docs site: the first deploy job and its `pages: write` permission

### M5 Packaging (end of version 1)

- [ ] T-0065 The plugin, npm packages attached to a GitHub release, the signed image, the versioned workflow, `fazon init`; a fresh repo adopts the framework from the README alone
- [ ] T-0066 Write permissions for image and release publishing (packages, attestations, releases), and the actions those workflows use in the allowed-actions list

## Phase 4: Results

- [ ] T-0070 M6: an article with the measured results
- [ ] T-0071 The publishing decision: publish and promote Fazon as an open-source tool, or keep it as a reference project
- [ ] T-0072 Turn on GitHub Discussions, with the publishing decision

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

- [ ] F-0001 The brief is committed as exported and excluded from the Markdown, spelling and EditorConfig gates rather than edited. With the repo's configs it fails one rule: markdownlint MD040 (a fenced code block without a language, the "Framework repo layout" block, line 393); typos and EditorConfig pass. A fix belongs in the design doc's next export (maintainer, 2026-11-25)
- [ ] F-0002 The hosted CLA assistant had several outages of 2 to 9 hours in October 2026; a required `license/cla` check with no bypass would block every merge during one (2026-11-25, T-0014)

- [x] F-0003 The first `lint` run on `main` failed: editorconfig-checker v4's archive holds the binary as `editorconfig-checker`, not `ec-linux-amd64`; the installer's one-match check caught it — fixed 2026-11-25, in the smoke-test pull request

## Open questions

<!-- questions for the maintainer; ID Q-NNNN -->

From the brief's [Open](../design/brief.md#open) table:

- [ ] Q-0001 How does the example repo consume the framework before M5? Proposal: pinned to one framework commit. Settled by M0 (T-0031)
- [ ] Q-0002 Which license covers what Fazon writes into an adopter's repo? Proposal: MIT-0 for all of it. Settled by M0 (T-0034)
- [ ] Q-0003 Which license does the example repo carry? Proposal: the same permissive license. Settled by M0 (T-0034)
- [ ] Q-0004 Does the CLA apply to the example repo? Proposal: it takes no outside contributions before the publishing decision. Settled by M0 (T-0034)
- [ ] Q-0005 Is the API in a spec framework-neutral, or written per framework? Proposal: neutral, mapped by the adapter. Settled by M0 (T-0020)
- [ ] Q-0006 One spec or several for a multi-part component? Proposal: one spec with named parts. Settled by M0 (T-0020)
- [ ] Q-0007 Which part of the token format does the build support? Proposal: the subset the build tool handles today. Settled by M0 (T-0033)
- [ ] Q-0008 Is the list of 15 components right? Proposal: the list under Milestones. Settled by M0
- [ ] Q-0009 Are baselines kept in git or in Git LFS? Proposal: in git. Settled by M1
- [ ] Q-0010 What is the budget for the measured API runs? Not set. Settled by M2
- [ ] Q-0011 Does the tokens' CSS ship inside the component package or as a package of its own? Proposal: inside the component package. Settled by M1

From the bootstrap:

- [ ] Q-0012 Where do run records and reports go? `.gitignore` holds the placeholder `.fazon/` until the run record document settles it (T-0028)
- [ ] Q-0013 Do source files carry a license header (for example an `SPDX-License-Identifier: GPL-3.0-or-later` line)? Decide before the first source file (M1)
- [ ] Q-0014 Reserve the npm name `fazon` now (free on 2026-11-25) with a placeholder package, or wait for the publishing decision? Publishing anything is the maintainer's call
- [!] Q-0015 The contributor agreement's governing law (`CLA.md`, Section 6.1) is blank (maintainer, at the review: T-0010)
- [!] Q-0016 Confirm the agreement's other fill-ins at the review: the maintainer personally as "We"; CC BY 4.0, CC BY-SA 4.0 and CC0 1.0 as the media licenses; "[or Your Affiliates]" left out of the patent license (maintainer, T-0010)

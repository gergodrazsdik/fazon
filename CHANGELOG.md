# Changelog

All notable changes to Fazon are in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). There is no release yet; releases are versioned from milestone M5.

## [Unreleased]

### Added

- `fazon generate` and `fazon feedback` refuse a spec without fixtures whose component has a required prop or slot, and SPEC-016 checks a state recipe's prop values against their types.
- `fazon spec check` checks every SPEC rule, SPEC-001 to SPEC-019, with the token set, the icon set and the adapter's extension schema; `propose`, `approve`, `generate` and `feedback` run the same check. Extension blocks for adapters the repository doesn't use are reported as notes.
- `fazon feedback <component> (-m <text> | --file <path>)` starts a feedback run that answers the component's latest generate or feedback run: its first prompt carries the developer's feedback and that run's last blocking findings, with fresh caps on the generator model, and its record and result name the run it answers.
- `fazon generate <component> [--clean]` runs a generate run until every check passes in the verifier image or a cap is reached; it refuses while the API isn't the approved one, a run is in progress, or generated files outside the component are stale, and ends with the run's HTML report.
- `fazon accept <component>` accepts the component's latest generate or feedback run into its provenance file when it passed and its spec, approved API, token set and files are unchanged since, and prints the `fazon baseline update` command when stories are new or changed.
- `fazon propose <component>`: one read-only agent call drafts the API from the spec, and the harness writes it into the spec's API fields for review as a diff.
- `fazon approve <component>` records the approved API's hash and date in the component's provenance file.
- `fazon spec check` reports placeholders left from the spec template (SPEC-019), so a fresh spec no longer passes.
- One agent run per component at a time: the agent commands refuse while another run of that component is in progress.
- The generate run's checks phase in the verifier image over the whole library, the generated-files refresh, the generate prompt and the generation skill (`plugin/skills/generate/`).
- `fazon report` builds a run's HTML report (gallery, checks and findings, judge verdicts, visual diffs, cost, iterations and the next step) in `.fazon/runs/<id>/report/`, self-contained with its images, and opens it in the browser; `--no-open` only prints its path, and `FAZON_STORYBOOK_URL` sets the Storybook its screenshots link to.
- The loop in `@fazon/core`: the iteration, budget and run-time caps, escalation to the escalation model, how an agent run ends, and run records for propose, generate and feedback runs; reading and writing a component's provenance file, with the approved API's hash.
- `fazon spec new` writes a spec from the MIT-0 template, and the Claude Code plugin in `plugin/` has its first skill, `spec`, which drafts a spec with the developer and runs `fazon spec check` until it's clean.
- The headless agent call in `@fazon/core`: the Claude Code settings of each call, `claude -p` with the call-time cap, cost and tokens from its stream-json output, and the snapshots that find violations (PERM-002) and hand edits; the adapter's self-check commands, which for Vue run vue-tsc, ESLint, Stylelint and Vitest on the component.
- The minimum Claude Code version, 2.1.332: `fazon doctor` warns when Claude Code is older or missing.
- The `ci` workflow runs the Vue adapter's browser tests (`just test-browser`) on pull requests.
- The reusable `verify.yml` workflow (`verify`, `judge` skipped until M3, `comment`) and `fazon report --summary`, with a self-test that calls it on the end-to-end fixture.
- `fazon verify` runs the source checks (build, lint, test, package) and the rendered checks (a11y, tokens, layout, visual) in the pinned verifier image, with a run record, exemptions, renamed baselines and `--base` marks; `fazon baseline update` writes baselines, `fazon.json` and `NOTICE.md` from a qualifying run; `just test-verify` runs them end to end.
- A paragraph content node for spec fixtures, `{ p: "text" }`, which renders as a `<p>`; plain strings stay inline text.
- `fazon sync` writes the token set's themes into `.storybook/generated/themes.ts`, which the Storybook preview imports, so a new theme reaches the theme switch and `sync --check` catches drift.
- Fazon's lint rules: a Stylelint plugin (`@fazon/core/stylelint`) for `raw-value`, `raw-token` and `unknown-token`, the `inline-suppression` rule for ESLint, Stylelint and TypeScript directives, the Vue adapter's ESLint and Stylelint configuration (`@fazon/adapter-vue/lint`), and lint output as findings.
- The Vue adapter records each component's and part's prefixed name (`defineOptions({ name })`, such as `FzButton`) in `api.json`, and `contract-api` checks it; `fazon sync` refuses a one-word component when `tokens.prefix` isn't set.
- The Vue adapter's API reader (vue-component-meta, in `api.json`'s form) and the setup a consumer imports: `fazonVitest()` (browser mode in Chromium with the `fazonVueApi` command), `fazonStorybook()` and `fazonPreview()` (the theme switch); `just test-browser` runs the generated contract tests and Storybook build.
- The rendered checks in `@fazon/core`: a page runner on the verifier's Chromium, and the `a11y` (axe-core and the spec's roles, names and ARIA), `tokens` (the winning declaration, followed to its token), `layout` and `visual` (PNG comparison, `fazon.json`, orphans) checks; `just test-rendered` and the `rendered` workflow run every M0 fixture in the verifier image.
- `fazon sync [--check]` with the Vue adapter: the token CSS, each component's story file, contract test, API and story manifest, and the entry file's exports; a component without its root file gets only its manifest and API until it's generated.
- The story matrix in `@fazon/core`: `buildManifest` writes a component's story manifest from its spec, and `checkManifest` checks MATRIX-001 and MATRIX-002.
- The CLI skeleton: `--json` output, exit codes, `fazon doctor` and `fazon spec check` (SPEC-001, SPEC-002); the core loads and validates the config and specs against the M0 schemas.
- The tokens pipeline in `@fazon/core`: it resolves a DTCG resolver document, checks TOKEN-001 to TOKEN-006, builds the token CSS with Style Dictionary 5.8.0 with a `data-theme` block for every theme, hashes the token set and indexes its custom properties.
- The verifier image (`verifier/`) on Playwright 1.65.1's image with pinned fonts, and the `verifier` workflow that builds and smoke-tests it and pushes `ghcr.io/gergodrazsdik/fazon-verifier:sha-<commit>` from `main`.
- The pnpm workspace with the first packages, `fazon` (the CLI), `@fazon/core` and `@fazon/adapter-vue`: TypeScript 6, Vitest, ESLint with the ADAPTER-001 rule, Prettier, a license identifier check, the `ci` workflow, and `just install`, `build`, `test`, `lint-ts` and `check`.
- Menu and Popover join the example library, which now has 17 components; the npm packages are `fazon` (the CLI), `@fazon/core` and `@fazon/adapter-vue`.
- The license terms, version 0: MIT-0 for everything Fazon writes into another repository and for the example repository, no license headers on written files, and where third-party notices go; `LICENSES/MIT-0.txt`, and the example library's license, notices and contributing drafts.
- The token set, version 0: a DTCG 2025.10 resolver and token files in the subset the build supports, raw and role tokens, themes, custom property names with a configurable prefix, the CSS `fazon sync` builds and the story frame's base styles, with schemas; and the example library's drafts: a neutral token set in light and dark with its contrast table, and its conventions doc.
- The repository: license, contributor agreement, community files, lint tooling and agent instructions. No product code yet.
- The spec format, version 0: the document, the JSON Schema of the front matter, and valid and invalid example specs, checked by `just lint`.
- The reusable workflow interface, version 0: how a consumer calls it, inputs, secrets and permissions, the `verify`, `judge` and `comment` jobs, artifacts and summary, with the caller workflow `fazon init` writes.
- The adapter boundary, version 0: what the core and an adapter each do, the Vue adapter (files, API mapping, stories, contract tests, commands, scaffold), and how the example repository consumes the framework before M5.
- The CLI reference, version 0: every command with its arguments, refusals and results, the developer's journey as commands, exit codes, and the JSON output envelope with its schema.
- The config file reference, version 0: `fazon.yaml`, every key with its default, local overrides in `fazon.local.yaml`, and validation, with schemas and examples.
- Run records and provenance, version 0: the `.fazon/` layout, the run record, the committed provenance file, calibration records, hashes and how measurement records are published, with schemas and examples.
- The measurement protocol, version 0: measured runs, loop metrics and how they're reported, judge calibration with mutation-seeded defects, and the thresholds for trusting the judge.
- The judge, version 0: when it runs, what it sees, the rubric derived from the spec, batching, its structured answer, authority and cost, with the plan and result schemas and a worked Button plan.
- The loop and caps, version 0: the kinds of run, what an iteration is and what blocks, the default caps and where they're enforced, escalation, feedback runs and how a run ends.
- The agent permission model, version 0: the paths the agent may read and write, the commands it may run, the files the harness maintains, and how breaches and hand edits are detected.
- The baseline lifecycle, version 0: where baselines live, how `fazon baseline update` writes them, and how the visual check treats them locally and in CI.
- The check catalogue, version 0: one rule sheet per check, and passing and failing HTML fixtures for the rendered checks.
- The story matrix rules, version 0: how stories are generated, produced, captured and named, the story manifest's JSON Schema, and the example specs' manifests.

### Fixed

- `@fazon/core` carries the generation skill in `dist/skills/generate/`, so `fazon generate` finds it wherever the package is installed; it failed with ENOENT where the framework was installed from a copy.
- `fazon propose` passes Claude Code a draft-07 copy of the proposal schema, which Claude Code 2.1.332 accepts; it rejected the 2020-12 schema before making a call.
- `fazon verify` and the generate run's checks pass over a component that has a spec but no code yet, instead of ending in error.
- A feedback run carries the developer's feedback in every prompt, not only the first, as its calls share no session.
- `fazon baseline update` takes the captures of a component's latest generate or feedback run when it passed, from its passing iteration, not only those of verify runs. A component's inputs hash leaves out its provenance file, so approving or accepting doesn't stop `baseline update`, and `fazon accept` compares a run accepted already with its checks again.
- `fazon verify` failed with `EROFS` on a laptop once Vite, Vitest or Storybook had left caches in `node_modules`; the working copy now links only the packages and pnpm's own entries. `fazonVueEslint()` ignores the run records in `.fazon/`.
- `fazon verify --base` read the base's baselines from the checkout's root, so a project in a subdirectory saw every baseline as added.

# Changelog

All notable changes to Fazon are in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). There is no release yet; releases are versioned from milestone M5.

## [Unreleased]

### Added

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

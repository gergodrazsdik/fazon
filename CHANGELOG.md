# Changelog

All notable changes to Fazon are in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). There is no release yet; releases are versioned from milestone M5.

## [Unreleased]

### Added

- The repository: license, contributor agreement, community files, lint tooling and agent instructions. No product code yet.
- The spec format, version 0: the document, the JSON Schema of the front matter, and valid and invalid example specs, checked by `just lint`.
- The judge, version 0: when it runs, what it sees, the rubric derived from the spec, batching, its structured answer, authority and cost, with the plan and result schemas and a worked Button plan.
- The loop and caps, version 0: the kinds of run, what an iteration is and what blocks, the default caps and where they're enforced, escalation, feedback runs and how a run ends.
- The agent permission model, version 0: the paths the agent may read and write, the commands it may run, the files the harness maintains, and how breaches and hand edits are detected.
- The baseline lifecycle, version 0: where baselines live, how `fazon baseline update` writes them, and how the visual check treats them locally and in CI.
- The check catalogue, version 0: one rule sheet per check, and passing and failing HTML fixtures for the rendered checks.
- The story matrix rules, version 0: how stories are generated, produced, captured and named, the story manifest's JSON Schema, and the example specs' manifests.

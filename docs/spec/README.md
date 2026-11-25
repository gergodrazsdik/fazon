# Specification documents

The M0 documents from the [brief](../design/brief.md#m0-documents). Each is written and merged through its own pull request, reviewed by the maintainer, and tracked in the [tracker](../plan/TRACKER.md) (Phase 1). M0 is done when all of them are merged and the repo holds documents, schemas and example data but no executable product code.

| # | Document | Status | Tracker |
|---|---|---|---|
| 1 | [Spec format](spec-format.md) and its [JSON Schema](schemas/spec.schema.json), including fixtures, multi-part components and exemptions | merged | T-0020 |
| 2 | [Story matrix rules](story-matrix.md), with the [story manifest schema](schemas/story-manifest.schema.json) | merged | T-0021 |
| 3 | [Check catalogue](check-catalogue.md), with one rule sheet per check | merged | T-0022 |
| 4 | [Baseline lifecycle](baseline-lifecycle.md), with the [baselines record schema](schemas/baselines.schema.json) | merged | T-0023 |
| 5 | [Agent permission model](agent-permissions.md) | merged | T-0024 |
| 6 | [Loop and caps](loop-and-caps.md): defaults, enforcement, and what an iteration is | merged | T-0025 |
| 7 | [Judge](judge.md): rubric, image batching and the CI cost cap, with the [plan](schemas/judge-plan.schema.json) and [result](schemas/judge-result.schema.json) schemas | merged | T-0026 |
| 8 | [Measurement protocol](measurement.md), including judge calibration and its thresholds | merged | T-0027 |
| 9 | [Run records and provenance](records.md), with the run record, provenance and calibration record schemas | merged | T-0028 |
| 10 | [Config file reference](config.md): name, format and keys, with the [config](schemas/config.schema.json) and [local override](schemas/config-local.schema.json) schemas | merged | T-0029 |
| 11 | [CLI reference](cli.md), covering every command, with the [JSON output schema](schemas/cli-output.schema.json) | merged | T-0030 |
| 12 | [Adapter boundary](adapter-boundary.md), including how the example repo consumes the framework before M5 | merged | T-0031 |
| 13 | Reusable workflow interface: inputs, secrets and permissions | not written yet | T-0032 |
| 14 | Conventions doc and token set, with its themes, for the example library (drafts that move to the example repo at M1) | not written yet | T-0033 |
| 15 | License terms for generated and scaffolded files, and for the example repo | not written yet | T-0034 |

When a document is merged, link it in the first column and set its status to `merged`.

Merging a document in M0 doesn't freeze it. The documents are expected to change as M1 to M5 show what works, and until version 1 nothing is released, so a change has no outside users to break. A change is a pull request that updates the document together with its schemas and example data. A change to a document's contract still needs the maintainer's approval, as any other.

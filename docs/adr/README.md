# Architecture decision records

Decisions about Fazon's architecture, process and licensing. The [design brief](../design/brief.md) is the starting point; ADRs record what was decided, refine it and supersede it. From now on a decision is recorded as an ADR in the pull request that makes it.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-baseline.md) | Baseline decisions from the design brief | accepted |
| [0002](0002-contributor-license-agreement.md) | Contributor License Agreement: Harmony, any outbound license | accepted, amended by 0004 |
| [0003](0003-bootstrap-answers.md) | License headers, run-record path, npm name and the agreement's governing law | accepted |
| [0004](0004-contributor-agreement-amended.md) | The contributor agreement, amended after a best-effort review | accepted |
| [0005](0005-spec-format.md) | Spec format: a neutral API with framework extensions, one spec per component | accepted |
| [0006](0006-story-matrix.md) | Story matrix: layered grids, real input, stable names | accepted |
| [0007](0007-check-catalogue.md) | Check catalogue: exact token identity, no inline suppressions, contract tests | accepted |
| [0008](0008-baseline-lifecycle.md) | Baseline lifecycle: an explicit update command, plain git, the image recorded | accepted |
| [0009](0009-agent-permissions.md) | Agent permissions: one component directory, allowlisted self-checks, committed generated files | accepted |
| [0010](0010-loop-and-caps.md) | Loop and caps: feedback as linked runs, $10 and 90 minutes per run | accepted |
| [0011](0011-judge.md) | Judge: a derived rubric, one call per question, $3 per CI run | accepted |
| [0012](0012-measurement.md) | Measurement protocol: autonomous runs, mutation-seeded defects, 80/5/90 thresholds | accepted |
| [0013](0013-records.md) | Records: one rewritten run record, latest-state provenance, measurements as release assets | accepted |
| [0014](0014-config.md) | Config: fazon.yaml, a limited local override, the image pinned explicitly | accepted |
| [0015](0015-cli.md) | CLI: explicit decision commands, feedback by command, JSON output everywhere | accepted |
| [0016](0016-adapter-boundary.md) | Adapter boundary: pre-release images on GHCR, git dependencies at a SHA, vue-component-meta | accepted |
| [0017](0017-workflow.md) | Reusable workflow: verify and judge jobs, the laptop's code path, a pull request comment | accepted |
| [0018](0018-token-set.md) | Token set: a DTCG resolver, role tokens by structure, a configurable prefix, a bundled font | accepted |

## Numbering and status

- Files are named `NNNN-short-title.md`: four digits, in order, never reused.
- Status is one of `proposed`, `accepted`, `superseded by NNNN` or `deprecated`.
- An accepted ADR isn't edited to change its decision: a new ADR supersedes it, and the old one's status points to the new one. Fixing typos and links is fine.
- Group related small decisions into one ADR rather than writing one file per tiny choice.
- Add the ADR to the index above in the same pull request.

## Template

[MADR](https://adr.github.io/madr/)-style:

```markdown
# NNNN: Title

- Status: proposed | accepted | superseded by NNNN | deprecated
- Date: YYYY-MM-DD
- Tracker: T-NNNN, Q-NNNN

## Context and problem statement

## Considered options

## Decision outcome

Chosen option: "…", because …

### Consequences

## More information
```

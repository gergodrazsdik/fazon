# Run records and provenance

What Fazon writes down about its work: a run record for every run, kept locally; a provenance file per component, committed with it; and a calibration record per judge model, shipped with the framework. The report and every published number are built from these records. Decisions behind them: [ADR 0013](../adr/0013-records.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0028.

## Scope

| What | Defined in |
|---|---|
| Runs, iterations and caps | [Loop and caps](loop-and-caps.md) |
| Findings | [Check catalogue](check-catalogue.md#findings) |
| Judge plans and results | [Judge](judge.md) |
| What is measured and published | [Measurement protocol](measurement.md) |
| `fazon report` and the commands that read records | [CLI reference](cli.md) |

## The `.fazon/` directory

Every run's files live under `.fazon/` in the repository where Fazon runs. Git ignores the directory ([ADR 0003](../adr/0003-bootstrap-answers.md)); nothing in it is committed.

```text
.fazon/
  runs/
    20261125T164012Z-button-3f9a/
      run.json              the run record
      calls/1.jsonl         the agent's transcript for each call
      captures/1/           captures and diff images of each iteration, by theme
      judge/3.json          each iteration's judge plan and results
      report/index.html     the report built from this run
    20261125T171502Z-verify-a41c/
      run.json              the run record
      verify.json           what the record has no field for, such as each story's visual status, per-component check statuses and the --base changes
      captures/             captures and diff images, by theme and component, such as dark/button/<story>.png
      logs/                 each tool's output, by step, such as build-types.log
      reports/              the lint and test tools' JSON reports
      storybook/            the static Storybook build the rendered checks load
      package/              the packed library tarball
```

A run's ID is its start time in UTC, the component's kebab-case name (or `verify`), and four random hex digits: `20261125T164012Z-button-3f9a`. IDs sort by start time.

Transcripts are local only. CI never uploads them, and published measurement records leave them out. The run's directory can be deleted at any time; the record of a run in progress is the only one the harness still needs.

## The run record

`run.json` ([schema](schemas/run-record.schema.json), [example](examples/records/run.json)) holds everything a run did. The harness rewrites it atomically after every step: each agent call, check phase and judge pass. A crash leaves the record of the last completed step, with the status `running`. Until its outcome is known, the iteration in progress is recorded as `stopped`, so after a crash it shows as one that never finished.

| Field | Content |
|---|---|
| `id`, `kind`, `parent`, `component` | The run, its kind (propose, generate, feedback, verify), the run a feedback run answers, and the component. |
| `status`, `reason` | `running`, `passed`, `failed`, `needs-a-person` with its reason, or `stopped`. Only a verify run ends `failed`: it has a blocking finding, or, with the reason `check-error`, a check ended in error or the image couldn't run the checks. Only an agent run ends `needs-a-person`. |
| `started`, `ended` | UTC timestamps. |
| `measurement` | The round and repeat of a measured run. |
| `versions` | The framework, adapter and Claude Code versions, the verifier image by digest, and the judge version. Claude Code's version is absent when the run made no agent call (a verify run), and the judge version when the run used no judge. |
| `inputs` | Hashes of the spec, the approved API, the token set, the conventions doc and the config at the start. |
| `config` | The caps, models, escalation threshold, judge policy and whether the judge was calibrated. In a local run, `judge.localPolicy: off` records the policy as `off`. |
| `iterations` | Each iteration: its agent call (model, effort, tokens, cost, duration, how it ended, transcript, files changed), any permission violations, its checks with their findings, the judge's summary, and its outcome. |
| `verification` | A verify run's checks and judge, which have no agent call. |
| `proposal` | A propose run's proposed API. |
| `handEdits` | Files a person changed between calls, by the iteration they followed. Changes before a run's first call aren't between its calls, and aren't recorded. |
| `totals` | Iterations; agent, judge and total cost; whether any cost was estimated; any overrun; tokens; duration; whether the run escalated. |

The judge's plan and every call's result are in the run's `judge/` directory. The record keeps a summary: the number of calls, the cost, verdict counts, and the findings of `fail` and `unsure` verdicts.

## Provenance

`<components>/<name>/generated/provenance.json` ([schema](schemas/provenance.schema.json), [example](examples/records/provenance.json)) is committed with the component, and only the harness writes it. It holds the component's latest accepted state:

- `spec`: the spec's path and hash;
- `api`: the hash of the approved API and the date it was approved. `fazon generate` refuses to run while the spec's API no longer has this hash ([spec format](spec-format.md#approval));
- `generation`: the framework version, the date the result was accepted, the accepted run and the runs linked to it (kind, status, iterations, models, cost), the number of hand edits, and the total cost.

It's overwritten when the component is regenerated; git keeps its history. It names no person: the approval and acceptance carry dates, and git records who committed them.

## Hashes

Hashes are SHA-256, written `sha256:<hex>`:

- **A file** (the spec, the conventions doc, the config): the hash of its bytes, with line endings normalised to LF.
- **The token set:** the hash of a text with one line per file, `<path> <file hash>`, every line ending in LF, the last one too:
  - the resolver document first, then each token file in the order the resolver names it: the sets' sources in `resolutionOrder`, then the theme contexts' sources, the contexts in document order;
  - a file named more than once is listed once, where it first appears;
  - paths are relative to the resolver document, whose own path is its file name;
  - a file hash is the hash of the file's UTF-8 text with line endings normalised to LF.
- **The approved API:** the hash of a canonical JSON form ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) of the spec's API fields: `props`, `events`, `slots`, `methods`, `forward`, `form`, `parts` without their `states`, `produce` and `a11y`, and `extensions`.

## Calibration records

`calibration/judge-<judge version>/<model>.json` in the framework repository ([schema](schemas/calibration-record.schema.json), [example](examples/records/calibration-claude-sonnet-5-5.json)) records one calibration round for one judge model. It holds:

- the judge version, model, framework version, round, date and components;
- each operator's cases, catches, `unsure` results, and the cases the checks caught with and without baselines;
- the measures, each as a value, its `n` and its 95% Wilson interval;
- the thresholds it was measured against;
- `calibrated`: whether it met them all;
- the link to the round's records.

A framework release ships the records of its judge version. The judge counts as calibrated for the configured model when its record says `calibrated: true` ([measurement protocol](measurement.md#calibrated-status)).

## Publishing measurement records

A measurement round is published as a GitHub release of the example repository. Its assets hold an archive of the round's run records and calibration results, without transcripts, captures or prompts. The published tables and calibration records link to that release, so every number can be recomputed from the records behind it.

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| RECORD-001 | Every run has a run record valid against its schema from its first step to its end. | the harness |
| RECORD-002 | The run record is replaced atomically: a reader never sees a partly written file. | the harness |
| RECORD-003 | Nothing under `.fazon/` is committed, and CI uploads no transcript. | `.gitignore`, the reusable workflow |
| RECORD-004 | A component's provenance file is valid against its schema and names the spec and approved API the committed code was generated from. | CI (`build` rule `generated`) |
| RECORD-005 | A published number links to the release that holds its records. | the maintainer, when publishing |

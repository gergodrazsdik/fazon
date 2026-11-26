# CLI reference

Every `fazon` command: what it does, its arguments and options, what it refuses, and what it prints. The CLI is the adopter's interface; it runs on the host with Node.js and runs every check inside the verifier image. Decisions behind it: [ADR 0015](../adr/0015-cli.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0030.

## Scope

| What | Defined in |
|---|---|
| The config every command reads | [Config file reference](config.md) |
| Runs, iterations and caps | [Loop and caps](loop-and-caps.md) |
| What the agent may do during a run | [Agent permission model](agent-permissions.md) |
| Baselines | [Baseline lifecycle](baseline-lifecycle.md) |
| Run records, provenance, `.fazon/` | [Run records and provenance](records.md) |
| What `fazon init` writes for the Vue adapter, and the CI workflow stub | [Adapter boundary](adapter-boundary.md#what-fazon-init-writes-for-vue), [reusable workflow interface](workflow.md#calling-it) |

## The journey

The [brief's journey](../design/brief.md#users-and-journey), as commands:

```text
fazon init                          adopt: config, tokens, conventions, CI stub
fazon spec new button               scaffold specs/button.md
fazon spec check button             validate it
fazon propose button                the agent drafts the API into the spec
fazon approve button                decision 1: the developer approves the API
fazon generate button               the loop
fazon report button                 read the result
fazon feedback button -m "…"        optional: another round with feedback
fazon accept button                 decision 2: the developer accepts the result
fazon baseline update button        write its baselines
git commit; open a pull request     decision 3: the reviewer approves
fazon verify                        after a token change: what moved
```

## Common behaviour

- **Config:** every command except `init` and `doctor` reads and validates `fazon.yaml` and any `fazon.local.yaml` first ([validation](config.md#validation)). They are read from the current directory; commands don't search the parent directories.
- **Component names:** a component is named in kebab-case (`button`, `radio-group`), as in its spec's file name.
- **Output:** human-readable text on standard output by default; warnings and errors on standard error.
- **`--json`:** every command accepts it. The command then prints one JSON document on standard output, valid against the [CLI output schema](schemas/cli-output.schema.json) ([examples](examples/cli/)): the command, its status and exit code, its messages with hints, and a `result` specific to the command. Each command's result schema arrives with the command's implementation; the fields are listed below.
- **Other global options:** `--help`, `--version`, `--verbose`, `--no-color` (also when `NO_COLOR` is set).

### Exit codes

| Code | Status | Meaning |
|---|---|---|
| 0 | `ok` | Done. |
| 1 | `failed`, `needs-a-person` | Checks or validation failed, or a run stopped and needs a person. |
| 2 | `refused`; usage and config errors | A wrong argument, an invalid config, or a precondition that isn't met (for example, the API isn't approved). |
| 3 | `error` | The environment or the tool failed: no container runtime, no API key, the image can't be pulled, the network or the API failed. |
| 130 | `interrupted` | The developer interrupted it. |

### Environment

| Variable | Used by | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | `propose`, `generate`, `feedback`, `verify` and `judge` (for the judge), `measure`, `calibrate` | The API key; Claude Code may use the developer's own login instead for local generation ([brief](../design/brief.md#authentication)). Never printed or written anywhere. |
| `FAZON_CONTAINER_RUNTIME` | every command that runs the verifier | `docker` or `podman`; detected when unset, Docker first. |
| `CI` | every command | When set, a `fazon.local.yaml` makes commands refuse, and `report` opens no browser. |
| `FAZON_STORYBOOK_URL` | `report` | The local Storybook the report's screenshots link to, an http or https URL; `http://localhost:6006` when unset. |
| `NO_COLOR` | every command | No colours in text output. |

## Setup

### `fazon init`

```text
fazon init [--adapter vue] [--dry-run]
```

Sets up a repository to use Fazon. It writes:

- `fazon.yaml`, with `image` set to the digest this CLI version supports;
- a starter [token set](tokens.md#files) and a conventions doc (from the adapter);
- an empty `specs/` directory;
- a short CI workflow that calls the [reusable one](workflow.md#calling-it);
- `.gitignore` entries for `.fazon/` and `fazon.local.yaml`;
- a `.gitattributes` entry marking baselines as binary.

It refuses (2) when `fazon.yaml` exists, and never overwrites a file. `--dry-run` lists what it would write. Result: the files written.

### `fazon doctor`

```text
fazon doctor
```

Checks the environment: Node.js, a container runtime, Claude Code and whether it's at least the minimum version this framework version declares ([ADR 0021](../adr/0021-settled-questions.md)), whether `ANTHROPIC_API_KEY` is set (without showing it), whether the verifier image is available, and whether the config is valid. It exits 3 when something needed is missing (Node.js, a container runtime), with install hints; 1 when the config is invalid; and 2 when a `fazon.local.yaml` exists in CI. A missing config is only a warning, as `doctor` also runs before `init`, and so are a missing or too old Claude Code and a missing API key, which CI's `verify` job doesn't need; `propose`, `generate` and `feedback` refuse to start (3) with a Claude Code older than the minimum. Result: each check and its state.

### `fazon upgrade`

```text
fazon upgrade
```

After the developer upgrades the CLI package, this sets `image` in `fazon.yaml` to the digest the new version supports. It prints the next steps: `fazon verify`, then `fazon baseline update --all` in the same pull request ([image upgrades](baseline-lifecycle.md#image-upgrades)). Result: the old and new image.

## Specs

### `fazon spec new`

```text
fazon spec new <component> [--tier primitive|form-control|composite]
```

Writes `specs/<component>.md` from the template, with every required field. It refuses (2) when the file exists. The spec skill drafts the content with the developer. Result: the path written.

### `fazon spec check`

```text
fazon spec check [<component>...]
```

Validates the named specs, or all of them, by every SPEC rule ([validation](spec-format.md#validation)). Exits 1 on findings. Result: per spec, its findings (rule, message, line).

## The loop

### `fazon propose`

```text
fazon propose <component>
```

A [propose run](loop-and-caps.md#runs): the agent drafts the API from the spec. The harness writes the proposed API into the spec's API fields, so the developer reviews it as a diff, edits it if needed, and then approves it. Result: the run, and the fields changed.

### `fazon approve`

```text
fazon approve <component>
```

Decision 1. Runs `spec check` on the spec, then records the hash of its API and today's date in the component's [provenance file](records.md#provenance). It refuses (2) when the spec has findings. A later change to the API needs another `approve`. Result: the API hash.

### `fazon generate`

```text
fazon generate <component> [--clean]
```

A [generate run](loop-and-caps.md#runs), until every check passes or a cap is reached. `--clean` first removes the component's own files, outside `generated/`, so the agent starts from nothing. It refuses (2) when the spec's API doesn't match the approved hash, or when the component has a run in progress. Exits 1 when the run ends as needs a person. Result: the run, its status and reason, iterations, cost, and the paths of its record and report.

### `fazon feedback`

```text
fazon feedback <component> (-m <text> | --file <path>)
```

Starts a [feedback run](loop-and-caps.md#feedback) linked to the component's latest run, with the developer's feedback in its first prompt. It refuses (2) when the component has no run. Result: as for `generate`.

### `fazon report`

```text
fazon report [<component> | <run-id>] [--no-open] [--summary]
```

Builds the HTML report of a run (the component's latest by default) and opens it in the browser. The report shows the gallery, check results, judge verdicts, cost, and the commands for the next step: `feedback`, `accept`, `baseline update`. `--no-open` only prints its path. `--summary` prints a short Markdown summary instead, as the [reusable workflow](workflow.md#what-it-reports) posts it. Result: the run, its kind and status, the report's path relative to the repository root, the number of images copied and whether a browser opened it; or the summary.

- **Which run:** a run ID names that run. A component names its latest run: an agent run of it, or a verify run that checked it; with `--summary`, only a verify run. Without either, the latest run.
- **Where:** `report/index.html` in the run's directory ([`.fazon/`](records.md#the-fazon-directory)), rebuilt each time. The captures, diff images and the baselines of changed stories that it shows are copied into `report/images/`, so the `report/` directory opens without a server and works as a CI artifact. The page is self-contained: inline CSS, no script and no external fetch; every text from the record is escaped.
- **What it shows:** the run's end and reason; the commands for the next step that fit the run; cost, tokens and duration; for an agent run, each iteration with its model, effort, call and checks; check results with their findings as blocking, advisory or exempt; the judge's verdicts when the record has them; visual diffs (baseline, capture and diff image); and the gallery of the verify run, or of the agent run's last iteration with captures.
- **Storybook links:** each screenshot links to its story in the local Storybook, in its theme: `FAZON_STORYBOOK_URL` when set, otherwise `http://localhost:6006`, the port `storybook dev` uses by default. The story's ID comes from the component's story manifest.
- **Opening:** with the platform's opener: `open` on macOS, the shell's file handler on Windows, `wslview` or `wsl-open` in WSL, `xdg-open` elsewhere. When none is installed or each fails, it warns and prints the path; it never fails for that. In CI (`CI` set) it doesn't try.

### `fazon accept`

```text
fazon accept <component>
```

Decision 2. Marks the component's latest run as accepted, and writes the `generation` part of its provenance file. It refuses (2) when that run didn't pass, or when the spec, approved API or component files changed since. When the run has new or changed stories, it prints the `baseline update` command to run next. Result: the accepted run.

### `fazon verify`

```text
fazon verify [<component>...] [--base <ref>] [--no-judge]
```

A [verify run](loop-and-caps.md#runs): renders and checks the named components, or all of them, in the verifier image, and runs the judge as the policy says. No agent call. The run ends as `passed`, or as `failed` (1) on a blocking finding. It exits 3 when a check ended in error or the image couldn't run the checks (the run ends `failed`, reason `check-error`), and on a host other than linux/amd64 ([where checks run](check-catalogue.md#where-checks-run)). Result: the run, and per component its checks, judge summary and findings.

- `--base <ref>` compares the baselines with those at `<ref>`, and marks the stories whose baselines were added, changed, removed or renamed, as [CI](baseline-lifecycle.md#in-ci) needs. With it, the judge looks only at the added and changed ones.
- `--no-judge` skips the judge; CI runs it in its own job with `fazon judge`.

### `fazon judge`

```text
fazon judge <run-id>
```

Runs the judge for an earlier verify run, on the stories it marked as added or changed, or on all of them when it had no `--base`. The judge's policy and CI cap apply. It refuses (2) when the run isn't a verify run, and exits 3 without an API key. Result: the judge's summary, added to the run's record.

### `fazon baseline update`

```text
fazon baseline update <component>... [--story <name>]...
fazon baseline update --all
```

Writes baselines from the latest qualifying run, and removes orphans, as [writing baselines](baseline-lifecycle.md#writing-baselines) defines. It keeps the directory's `NOTICE.md` current ([license terms](licensing.md#lucide)). It refuses (2) when no run qualifies, and says which condition failed. Result: the baselines written, unchanged and removed.

## Repository

### `fazon sync`

```text
fazon sync [--check]
```

Regenerates every component's `generated/` directory (story files, contract tests, story manifest) and the package entry file's exports from the specs, and builds the token set into its CSS file ([the build](tokens.md#the-build)) and its themes into the module the Storybook preview imports them from (for Vue, `.storybook/generated/themes.ts`). Until a component's root file exists, such as `src/components/button/Button.vue`, sync writes only the component's story manifest and API, with no story files, contract tests or export, and lists the component as not generated yet; so the library and its checks build between `approve` and `generate`. It refuses (2) a token set that breaks a [TOKEN rule](tokens.md#rules), and a spec the adapter can't write, such as a one-word Vue component with no `tokens.prefix` ([component names](adapter-boundary.md#component-names)). With `--check`, it writes nothing and exits 1 when the committed files differ. CI runs it as the `build` rule `generated`. Result: the files that changed or differ, and the components not generated yet.

### `fazon runs`

```text
fazon runs [<component>] [--limit <n>]
```

Lists runs from `.fazon/runs/`, newest first: ID, kind, component, status, iterations, cost. Result: the runs.

### `fazon prune`

```text
fazon prune [--keep <n>] [--older-than <days>]
```

Deletes run directories from `.fazon/runs/`. By default it keeps each component's latest 10 runs, and always keeps runs in progress, the runs an accepted provenance names, and the latest run of each component. Result: the runs deleted.

## Measurement

These are for the maintainer; they follow the [measurement protocol](measurement.md).

### `fazon measure`

```text
fazon measure --round <n> [<component>...] [--repeats <n>]
```

Makes measured runs: for each component and repeat, a propose run and a generate run from a clean checkout, with the runs' `measurement` fields set. It refuses (2) with a `fazon.local.yaml`, uncommitted changes, or credentials other than an API key. Result: the runs, and the loop metrics of the round.

### `fazon calibrate`

```text
fazon calibrate --round <n> [--model <model>] --out <path>
```

A calibration round: applies every mutation operator to every calibration component, runs the checks with and without baselines and the judge, repeats every judge call for self-agreement, and writes a [calibration record](records.md#calibration-records) to `--out`. The same refusals as `measure` apply. Result: the measures and whether the thresholds are met.

## Rules

| Rule | What must hold |
|---|---|
| CLI-001 | With `--json`, a command prints exactly one document valid against the CLI output schema, and nothing else on standard output. |
| CLI-002 | Exit codes and statuses match the table above. |
| CLI-003 | No command prints, logs or writes a credential. |
| CLI-004 | `init`, `spec new` and `upgrade` never overwrite a file a person wrote, except `upgrade`'s one `image` line. |
| CLI-005 | Every command that refuses says which condition failed and how to meet it. |

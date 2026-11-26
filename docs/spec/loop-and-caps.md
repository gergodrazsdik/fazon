# Loop and caps

How the harness runs the loop: the kinds of run, what one iteration is, what blocks, the caps and where each is enforced, escalation to the stronger model, feedback rounds, and how a run ends. The agent edits files; the harness decides what runs next ([brief](../design/brief.md#the-loop)). Decisions behind it: [ADR 0010](../adr/0010-loop-and-caps.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0025.

## Scope

| What | Defined in |
|---|---|
| What the agent may touch and run during a call | [Agent permission model](agent-permissions.md) |
| The checks and their findings | [Check catalogue](check-catalogue.md) |
| Visual diffs of the component being generated | [Baseline lifecycle](baseline-lifecycle.md#the-visual-check-by-context) |
| The judge's rubric, its calibration status and policy | [Judge](judge.md), [measurement protocol](measurement.md#calibrated-status) |
| What a run record stores | [Run records and provenance](records.md) |
| The keys for caps and models | [Config file reference](config.md) |
| The commands that start runs | [CLI reference](cli.md) |

## Runs

| Run | Started by | What happens |
|---|---|---|
| **propose** | `fazon propose <component>` | One agent call drafts the API from the spec. No checks run; the run ends waiting for the developer to approve the API. |
| **generate** | `fazon generate <component>` | Iterations until every check passes or a cap is reached. |
| **feedback** | `fazon feedback <component>`, with the developer's feedback from the review in `fazon report` | A generate run linked to the previous run, with the developer's feedback in the prompt. |
| **verify** | `fazon verify` | Renders and checks every component; no agent call. |

Every run writes a run record. A feedback run names its parent run; a component's linked runs together form one piece of work in the measurements, and each feedback round counts as a human intervention.

## An iteration

One iteration of a generate or feedback run is:

1. **Prompt:** the harness builds the agent's input ([agent permissions](agent-permissions.md#what-the-agent-receives)), with the findings of the previous iteration.
2. **Agent call:** one headless `claude -p` call, which edits the component's files.
3. **Permission check:** the harness compares the files outside the allowed paths ([PERM-002](agent-permissions.md#rules)). A violation ends the run.
4. **Checks:** every check in the verifier image ([check catalogue](check-catalogue.md)), over the whole library as `fazon verify` with no component named runs them, so a regression in another component blocks too. Before them, the harness refreshes the component's generated files ([agent permissions](agent-permissions.md#files-the-harness-maintains)). When the image ends without writing its results, every check of the phase ends in error.
5. **Judge:** when the checks pass and the judge's policy isn't `off`, the judge looks at the stories (from M3).
6. **Outcome:** the iteration **passes** when no finding blocks; otherwise it **fails**, and its blocking findings go into the next prompt.

The run **passes** with its first passing iteration and goes to the local review. A run that passes on iteration 1 counts as a first pass.

- A call that doesn't complete (stopped at the call-time cap or at its budget limit, or ended in error) fails its iteration without checks; the next call follows if the caps allow it.
- A check that ended in error or was skipped fails the iteration: it didn't show that the component is right.
- When the run-time cap is reached between the call and the checks, the iteration ends as `stopped`, unchecked.

### What blocks

| Finding | Blocks |
|---|---|
| An unwaived finding of any check | yes |
| A visual diff (`changed`, `orphan`) of the component being generated | no: shown in the report for the person |
| A judge `fail` | only once the judge's calibration meets the thresholds ([judge](judge.md#authority-and-policy), [measurement protocol](measurement.md#thresholds)); before that, shown in the report |
| A judge `unsure` | never |
| A finding a spec exemption waives | no |

Nothing else changes what blocks: the harness never relaxes a check, and the agent can't edit the spec, its exemptions, the checks or the config.

## Caps

| Cap | Default | Counts | Enforced |
|---|---|---|---|
| **Iterations** | 5 per run | agent calls of the run | before each call: no call starts once the run has made 5 |
| **Budget** | $10 per run | the cost of the run's agent calls and judge calls | before each call: no call starts once the run has spent the budget; each call is also given what remains, as its own limit |
| **Run time** | 90 minutes per run | wall-clock time since the run started | before each call and before each check phase; the run stops when it's exceeded |
| **Call time** | 20 minutes per agent call | wall-clock time of one call | during the call: the harness stops a call that exceeds it, and the iteration fails |

The [config file](config.md#keys) sets all four. A propose run has the same budget and call-time caps, and one call.

- **Cost of an agent call:** what Claude Code reports for the call. With an API key it's exact; under a subscription login it's Claude Code's local estimate, and the run record says so.
- **Cost of a judge call:** computed by the harness from the API's token usage and the prices in the config.
- **Overrun:** a call that Claude Code can't stop at its limit may spend past the budget; the run record shows by how much, and no further call starts.

When the iteration, budget or run-time cap stops a run whose last iteration failed, the run ends as **needs a person**, with that iteration's findings attached.

## Escalation

The generator model starts each run. After **2 failed iterations**, the remaining iterations of that run use the escalation model. A feedback run starts again on the generator model.

| Role | Default | Config |
|---|---|---|
| Generator | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | yes |
| Escalation | Claude Opus 5.5 (`claude-opus-5-5`) | yes |
| Failed iterations before escalating | 2 | yes |

Each model runs at its own default effort unless the config sets one. The run record stores the model and effort of every call, so the measurements can compare them per iteration.

## Feedback

In the local review, the developer can send feedback in plain words. That starts a feedback run:

- it's linked to the run it answers, and starts with fresh iteration, budget and time caps;
- every prompt of the run carries the feedback, as calls share no session; the first also carries the previous run's last findings ([ADR 0024](../adr/0024-feedback-in-every-prompt.md));
- it counts as a human intervention, and its cost counts toward the component's total in the measurements.

## How a run ends

| End | When |
|---|---|
| **passed** | An iteration passed. The run goes to the local review. A verify run passes when every check passed. |
| **failed** | Only a verify run: a check found a blocking finding, or ended in error, or the image couldn't run the checks (reason `check-error`). |
| **needs a person** | Only an agent run: a cap stopped it after a failed iteration; a [permission violation](agent-permissions.md#hand-edits); the component needs a dependency or a change to shared code; the same check ended in error in two check phases in a row; the spec, approved API, token set, conventions doc or config changed during the run ([LOOP-004](#rules)). |
| **stopped** | The developer interrupted it. |

Every end keeps the run record and the report. "Needs a person" lists its reason and the findings.

The agent says that the component needs a dependency or a change to shared code with a line of its final message: `FAZON-NEEDS dependency: <what>` or `FAZON-NEEDS shared-code: <what>`. The run then ends after the call, without checks. A propose run passes when its call completes without a violation, with an answer the harness can use; a call that doesn't complete ends it as needs a person, with the reason `budget` when the call was stopped at its budget limit, and `iterations` otherwise, as its one call is spent. An answer the harness can't use, with no API or one that would make the spec break a SPEC rule ([`fazon propose`](cli.md#fazon-propose)), ends the call in error, so the run needs a person with the reason `iterations`.

## Example

A Button run with the defaults:

| Iteration | Model | Result | Spent |
|---|---|---|---|
| 1 | Sonnet 5.5 | fails: `tokens`/`raw-value`, `layout`/`target-size` | $1.10 |
| 2 | Sonnet 5.5 | fails: `layout`/`target-size` | $2.05 |
| 3 | Opus 5.5 | passes | $4.20 |

The run passes on iteration 3 and goes to the local review. Had iteration 5 failed, or the spend reached $10 first, the run would have ended as needs a person.

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| LOOP-001 | No agent call starts once the run has reached its iteration, budget or run-time cap. | the harness |
| LOOP-002 | No agent call runs longer than the call-time cap. | the harness |
| LOOP-003 | After the configured number of failed iterations, the run's later calls use the escalation model. | the harness |
| LOOP-004 | A run passes only through an iteration with no blocking finding, with the spec, checks and config unchanged since the run started. | the harness |
| LOOP-005 | Every call's model, effort, tokens, cost and duration, and every iteration's findings, are in the [run record](records.md#the-run-record). | the harness |

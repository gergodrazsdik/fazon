# Measurement protocol

How Fazon's published numbers are produced: what a measured run is, which loop metrics are reported and how, how the vision judge is calibrated with seeded defects, and the thresholds it must meet before its verdicts may block. The project's claim is its numbers ([brief](../design/brief.md#measurement)). Decisions behind it: [ADR 0012](../adr/0012-measurement.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0027.

## Scope

| What | Defined in |
|---|---|
| Runs, iterations and caps | [Loop and caps](loop-and-caps.md) |
| The judge, its rubric and authority | [Judge](judge.md) |
| The fields of run records and calibration records | [Run records and provenance](records.md) |
| The budget for measured API runs | Q-0010, settled in M2 |

## Measured runs

A measured run is a generate run made under fixed conditions, so that runs can be compared and repeated:

- **Code:** a clean checkout of the example repository, at a commit that pins one framework version. The component's own files are removed. The spec and its approved API (from the component's provenance file) stay.
- **Pinned:** the verifier image, the Claude Code version and the models are pinned; the run record names each.
- **Settings:** the default caps and models of that framework version, unless an experiment states otherwise.
- **Credentials:** an API key, so that costs are exact.
- **No person in the loop:** the run starts from the approved API, with no review feedback and no hand edits. A run that ends as "needs a person" counts as not passing.
- **Independence:** each repeat starts from its own clean checkout, and repeats run one after another.

The API proposal is measured separately. Each repeat also makes one propose run, whose cost counts toward the component's cost and whose output is discarded.

### Repeats

Every component is measured **5 times** per measurement round. Every published number states its count `n`.

| Round | When | Components |
|---|---|---|
| 1 | end of M2 | Button, Badge, Link, Dialog |
| 2 | end of M4 | all 17 |

**Budget:** measured runs and calibration rounds through M3 share a budget of USD 150 ([ADR 0021](../adr/0021-settled-questions.md)). Before a round starts, its estimate is compared with what's left; a round that would exceed it waits for the maintainer's approval. The budget for M4's round is set before it.

## Loop metrics

From the run records of a round:

| Metric | Definition | Reported as |
|---|---|---|
| First-pass rate | share of runs that pass on iteration 1 | proportion with a 95% Wilson interval |
| Pass rate | share of runs that pass within the caps | proportion with a 95% Wilson interval |
| Iterations | iterations of passing runs | median and interquartile range; failing runs counted apart |
| Escalation rate | share of runs that used the escalation model | proportion |
| Cost per run | agent and judge calls of a run, in USD | median and mean |
| Cost per passed component | total cost of all runs and propose runs, divided by the number of passing runs | one figure per component and for the library |
| Tokens | input, cached input and output tokens per run | median |
| Wall-clock time | run duration | median and interquartile range |
| Stops | runs ended by each cap, by a violation, or by a needed dependency | counts |

Results are given per component and for the library. Each table states the framework version, the models, `n`, and the date.

### Human interventions

Measured runs have none by construction. Interventions are counted from the run records of real development, outside measured runs, and reported separately as observed counts per component:

- API corrections at approval;
- feedback runs;
- hand edits.

## Judge calibration

Calibration measures how well the judge catches defects a viewer can see, how often it fails good components, and how often it agrees with itself. It runs on components that pass every check.

| Round | When | Components |
|---|---|---|
| 1 | M3 | Button, Badge, Link, Dialog |
| 2 | after M4 | all 17 |

### Seeded defects

A defect is made by a **mutation operator**: a deterministic CSS change that the harness adds to the page after a story loads and before it's captured, scoped by `data-part` and state attributes. The component's code and the story build stay unchanged ([ADR 0027](../adr/0027-m3-federation-calibration-cost.md)). A case's **affected stories** are those whose capture, in any theme, differs from the unmodified component's, so a catch can be attributed. An application that changes no capture isn't a case.

| Operator | Class | Change | Expected to catch it |
|---|---|---|---|
| `raw-color` | measurable | a role token replaced by its literal value | `tokens` `raw-value`; `lint` reads only the source, which the operator doesn't change |
| `low-contrast` | measurable | text colour replaced by a lighter role token | `a11y` `color-contrast` |
| `clipped-text` | measurable | no wrapping, hidden overflow, a fixed width | `layout` `clipped-text` |
| `target-shrunk` | measurable | the smallest size's padding set to 0, and its minimum height removed | `layout` `target-size`, where a 24 px circle centred on the target reaches another target, as for stacked or small targets: WCAG 2.5.8 lets the others pass |
| `padding-step` | measurable | the root's padding one token step larger | `visual` `changed`, with baselines |
| `focus-ring-removed` | measurable | no outline on `:focus-visible` | `visual` `changed`, with baselines |
| `emphasis-swapped` | viewer-only | primary and secondary exchange their colour tokens | judge, `axis-variant` |
| `variants-collapsed` | viewer-only | one variant takes another's tokens | judge, `axis-<prop>` |
| `state-indistinct` | viewer-only | a state's tokens set to the default state's | judge, `state-<state>` |
| `state-misleading` | viewer-only | disabled styled with the danger colour | judge, `state-disabled` |
| `icon-misaligned` | viewer-only | an icon shifted by one spacing step | judge, `story` or `appearance-<n>` |
| `out-of-family` | viewer-only | a radius and font weight from outside the library's conventions, still as role tokens | judge, `family` |

An operator applies only where the component has what it changes. For example, `emphasis-swapped` needs a variant axis. Every applicable operator is applied to every calibration component, one at a time. Each application is a **case**.

### Measures

| Measure | Definition |
|---|---|
| Catch rate | share of viewer-only cases in which the judge fails at least one affected story. `unsure` doesn't count as caught; it's reported. |
| Catch rate per operator | the same, for each operator |
| Check catch rate | for every case, whether a deterministic check fails; measured with baselines and without them, as for a new component |
| False-positive rate | share of the stories of unmodified components that the judge fails |
| Self-agreement | every call of the calibration set is repeated 5 times. For each image, the share of repeats that give its most common verdict, averaged over images |
| Cost | judge cost per component and per case, at the batch price the round paid |

The comparison with the checks shows which defects only the judge catches. Measurable cases are reported too, so a judge that only repeats the checks is visible.

### The calls a round makes

Each call is the one the judge makes in a run, so that the measures describe the judge as it is used. Within that, a round spends as little as it can:

- **Unmodified components:** the whole plan, as for a new component without baselines.
- **Cases:** only the plan's calls that include an affected story, with the plan's own batches. A call without one would answer as it does for the unmodified component, which the round judges anyway.
- **Batches:** calls go through the Message Batches API, at half the price of a direct call and with the same requests.
- **Stages:** the unmodified components come first. Their measured cost per call gives the estimate for the cases, which start only when it fits what's left of the [budget](#repeats); otherwise the maintainer decides. Each model is a stage of its own: Sonnet 5.5 first, then Opus 5.5 with an estimate from Sonnet's measured costs.

### Thresholds

The judge's verdicts may block in the local loop ([judge](judge.md#authority-and-policy)) only when one calibration round meets all of these:

| Measure | Threshold | Sample |
|---|---|---|
| Catch rate, viewer-only | at least 80% | at least 40 cases |
| Catch rate per viewer-only operator | at least 60% | at least 10 cases each |
| False-positive rate | at most 5% | at least 40 unmodified stories |
| Self-agreement | at least 90% | the whole calibration set |

Thresholds apply to point estimates; every result is published with its 95% Wilson interval and its `n`. Each model in the comparison (Sonnet 5.5, Opus 5.5) is calibrated and reported separately.

A round that doesn't reach the sample sizes is published, but can't make the judge calibrated. Four components may not yield enough cases. The first round adds cases by applying an operator once per state, variant pair and part where it can, and says whether it reached the sizes. If it doesn't, the judge stays advisory until the second round.

### Calibrated status

A calibration round produces a [calibration record](records.md#calibration-records) for one judge model and one **judge version**. The judge version changes whenever the framework changes the judge's instructions, the rubric rules or the result schema. A framework release ships the records of its judge version. The judge counts as calibrated when the release has a record that meets every threshold for the configured model. A new judge version, or a model without a record, is advisory until it is calibrated again.

## Publishing

- Numbers come only from measured runs and calibration rounds under this protocol, with their framework version, models, `n` and intervals.
- The run and calibration records behind a published table are kept with it, so the table can be recomputed.
- A number from a smaller or different setup is labelled as such, or not published.

## Experiments after version 1

These follow the same protocol, each changing one thing:

- the loop with and without the judge;
- the generator model against the escalation model on the same specs;
- another vendor's vision model as the judge.

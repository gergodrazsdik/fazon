# Judge

How the vision judge decides what the checks can't measure: when it runs, what it sees, how its questions are built from the spec, how images are batched into calls, what it answers, what its verdicts may block, and what it may cost. Decisions behind it: [ADR 0011](../adr/0011-judge.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0026.

## Scope

| What | Defined in |
|---|---|
| Which stories the judge sees in which theme (the manifest's `judge` field) | [Story matrix rules](story-matrix.md#themes) |
| What a judge verdict blocks in the loop, and the run's budget | [Loop and caps](loop-and-caps.md#what-blocks) |
| Which baselines need the judge before they're accepted, and which are new or changed in CI | [Baseline lifecycle](baseline-lifecycle.md) |
| Calibration, its thresholds, and when the judge counts as calibrated | [Measurement protocol](measurement.md#judge-calibration) |
| How verdicts are stored | [Run records and provenance](records.md) |
| The judge's model, policy, cap, repeats and prices | [Config file reference](config.md) |
| The CI step, its secret and fork handling | [Reusable workflow interface](workflow.md#judge) |

## When the judge runs

| Where | When | Which stories |
|---|---|---|
| Local loop | in an iteration whose checks pass, unless the policy is `off` | every story of the component, in the themes the manifest gives |
| CI | after the checks, unless the policy is `off` or the pull request comes from a fork | the stories whose baselines the pull request adds or changes |
| Calibration | as the measurement protocol says | the calibration set |

The judge is called directly through the API: locally with an API key, and in CI through workload identity federation or an API key secret ([workflow](workflow.md#credentials), [ADR 0027](../adr/0027-m3-federation-calibration-cost.md)). It's skipped on pull requests from forks, which can get neither.

## What the judge sees

- **The spec:** its front matter and body, as text. Never the code, and never the checks' findings.
- **Captures:** one image per story and theme, the 2x crop the [story matrix rules](story-matrix.md#capture) define, labelled with the story's name.
- **Baseline and diff:** for a story whose capture differs from its committed baseline, the baseline and a diff image as well.
- **The reference image,** if the spec names one.
- **Other components:** for the family question, the default story's baseline of up to five other components.

Every image stays within the API's limits for one image: 2,576 px on the long edge and 4,784 visual tokens. The harness scales a larger one down proportionally. Story crops are well inside the limits; a full-viewport capture (2048 by 1536 px) costs about 4,000 visual tokens.

Measurable properties stay with the checks: sizes, spacing values, colours and contrast, clipping and overflow. The judge's instructions say so, and no question asks about them.

## The rubric

The rubric is the fixed list of questions the judge answers for a component. The harness derives most of them from the spec and the manifest; a spec may add its own in its `judge` field ([spec format](spec-format.md#judge-questions)).

| Question | Kind | Images | Themes |
|---|---|---|---|
| `story`: does each story look the way the spec describes for its props, state and content? | each | every story the judge sees | every theme |
| `axis-<prop>`: do the values of the axis read as distinct, and as the spec describes them? | compare | the axes grid's stories where every other axis is at its default | every theme |
| `state-<state>`, `state-<part>-<state>`: is the state visibly different from default, in the way the spec describes? | compare | the default story, and the state's story with every axis at its default | the default theme |
| `appearance-<n>`: do these stories meet the spec's *n*th `## Appearance` statement? | compare | the axes and include grids' stories | every theme |
| `reference`: does the component match the reference image's look? | compare | the default story and the reference image | the default theme |
| `family`: does the component look like it belongs with these? | compare | the default story, and other components' default baselines | the default theme |
| `change-<story>`: is this change consistent with the spec, and does it look intended? | each | the story's baseline, capture and diff | the story's theme |
| a spec question | compare, or each when it selects one story | the stories its `select` picks; the axes grid without one | the themes those stories are judged in |

- A **compare** question is answered with its images side by side, so that "primary reads as more prominent than secondary" can be judged at all. Every image still gets its own verdict.
- An **each** question judges every image on its own.
- `change-<story>` questions are asked for every story whose baseline exists and differs. In CI, only questions that include an added or changed story are asked.
- `family` is left out until another component has baselines.

## Batching

The harness turns the rubric into a **plan**: one call per question, theme and batch of at most 20 images, in the rubric's order ([schema](schemas/judge-plan.schema.json)). For the [Button example](examples/specs/valid/button.md), the [plan](examples/judge/button-plan.json) has 17 calls with 102 images in total.

Each call is independent, with a fresh context:

1. **System instructions:** fixed text, versioned with the framework. They say what to judge (what the spec says and the checks can't measure), what not to judge, and to answer `unsure` when the images can't decide.
2. **The spec,** as a prefix that stays the same across a component's calls, so it is cached.
3. **The question,** then each image, after a text label giving its name and kind.

Calls may run in parallel.

## The answer

Each call returns structured output, which the API enforces with the [result schema](schemas/judge-result.schema.json) ([example](examples/judge/button-axis-variant-result.json)). It contains a verdict for every image:

- `pass`: the image does what the question asks;
- `fail`: it doesn't, and the findings say why;
- `unsure`: the images can't decide it.

Each finding has a **severity** (`high` when the image contradicts the spec; `medium` when it's noticeably off; `low` for polish) and a message in plain words. Findings carry no coordinates, because the model's localisation is only approximate.

A story's **verdict** combines its calls: `fail` if any call failed it; otherwise `unsure` if any call was unsure; otherwise `pass`. A story no call covered (a cap, an error, a skipped call) is **not judged**, with the reason.

## Model and settings

| Setting | Default | Config |
|---|---|---|
| Model | Claude Sonnet 5.5 (`claude-sonnet-5-5`), compared with Claude Opus 5.5 in calibration | yes |
| Thinking and effort | the model's defaults | yes |
| Repeats per call | 1 | yes |
| Images per call | 20 at most | no |

With more than one repeat, the majority verdict of each image wins, and a tie is `unsure`. [Calibration](measurement.md#measures) measures how often single calls agree with themselves, and may recommend more repeats.

If the model declines a call, or the API still fails after its retries, every image of that call is `unsure`, with the reason recorded.

## Authority and policy

- **Locally:** the judge is advisory until its calibration meets the [thresholds](measurement.md#thresholds) for the configured model and judge version. After that, a `fail` goes back into the loop. `unsure` never blocks.
- **In CI:** the policy is `advisory` (the default), `blocking` or `off`. With `blocking`, a `fail` fails the judge step; `unsure` and "not judged" never do.
- **Baselines:** `fazon baseline update` requires a verdict, of any kind, for every story it writes, unless the policy is `off` ([baseline lifecycle](baseline-lifecycle.md#writing-baselines)).

## Cost

Every call's tokens and cost are recorded. The harness computes the cost from the API's usage and the prices in the config.

- **Locally,** judge calls count toward the run's budget ([loop and caps](loop-and-caps.md#caps)).
- **In CI,** the judge has its own cap: **$3 per workflow run** by default. The harness makes the plan's calls in order, component by component. Once the cap is spent, it makes no more calls, and the rest of the stories are reported as not judged.

A component like Button costs well under a dollar per judge pass with Claude Sonnet 5.5: crops are small, and the spec is a cached prefix. Calibration measures the real cost.

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| JUDGE-001 | No judge prompt contains the component's code or the checks' findings. | the harness |
| JUDGE-002 | Every call has a fresh context, at most 20 images, and the result schema as its response format. | the harness |
| JUDGE-003 | Every story the judge should see gets a verdict, or is reported as not judged with a reason. | the harness |
| JUDGE-004 | In CI, no call starts once the judge's cap is spent. | the harness |
| JUDGE-005 | Before calibration, no judge verdict blocks; `unsure` never blocks. | the harness, CI |

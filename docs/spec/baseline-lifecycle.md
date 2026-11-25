# Baseline lifecycle

How screenshot baselines are created, compared, changed, renamed and removed, locally and in CI. The [visual check](check-catalogue.md#visual) compares each story's capture with its baseline; this document says where baselines come from and who may change them. Decisions behind it: [ADR 0008](../adr/0008-baseline-lifecycle.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0023.

## Scope

| What | Defined in |
|---|---|
| Story names, themes and capture conditions | [Story matrix rules](story-matrix.md) |
| The comparison, its tolerance and platform | [Check catalogue: visual](check-catalogue.md#visual) |
| That the agent never edits baselines | [Agent permission model](agent-permissions.md) |
| How the loop treats findings | [Loop and caps](loop-and-caps.md) |
| Which stories the judge sees in CI, and its policy | [Judge](judge.md) |
| Run records, where captures are kept | [Run records and provenance](records.md) |
| The baselines directory key, the judge policy key | [Config file reference](config.md) |
| `fazon baseline` and its options | [CLI reference](cli.md) |
| The CI job that compares and summarises baselines | Reusable workflow interface (T-0032) |

## Where baselines live

Baselines are PNG files committed in the consumer repo, in plain git. By default they live in `baselines/` at the repository root; the config file can name another directory.

```text
baselines/
  fazon.json                                     the verifier image they were made with
  light/button/label--variant-primary--size-md--default.png
  dark/button/label--variant-primary--size-md--default.png
  light/dialog/confirm--content-size-md--default.png
  …
```

- A baseline's path is `<theme>/<component>/<story name without "<component>--">.png` ([story matrix rules](story-matrix.md#names)).
- `fazon.json` records the verifier image, by digest, that made every baseline in the directory ([schema](schemas/baselines.schema.json), [example](examples/baselines/fazon.json)).
- PNG files are losslessly optimised when they are written. The comparison decodes pixels, so optimisation never changes a result.
- `fazon init` marks `*.png` in the directory as binary in `.gitattributes`.

Only `fazon baseline update` writes into the directory. The agent never does, and CI never does.

## Writing baselines

`fazon baseline update` writes baselines from the captures of an earlier run; it renders nothing itself.

```text
fazon baseline update <component>... [--story <name>]...
fazon baseline update --all
```

- **With components:** for each component, it writes a baseline for every new and changed story, and removes the component's [orphans](#orphans). With `--story`, it writes only the named stories, and removes no orphans.
- **With `--all`:** it does the same for every component, and removes baselines of components that no longer have a spec. It's the only form that may record a different image in `fazon.json` (see [image upgrades](#image-upgrades)).

It takes the captures from the component's latest run, and refuses unless that run:

1. ran in the verifier image recorded in `fazon.json`, or in any pinned image with `--all`, on linux/amd64;
2. passed every check other than `visual`, with the exemptions in the spec;
3. had the judge look at every story it would write: a verdict of any kind is enough, as the person decides. This doesn't apply when the judge's policy in the config is `off`, as it is before the judge exists (M1 and M2);
4. is newer than the last change to the component's spec and files.

A baseline whose pixels equal the capture's isn't rewritten, so running the command twice changes nothing.

## The visual check by context

| Context | A changed or orphaned baseline of the component being worked on | Of any other component | A new story |
|---|---|---|---|
| `fazon generate <component>` | advisory: in the report, not a finding the agent sees | fails | reported as new |
| `fazon verify` | fails | fails | reported as new |
| CI | fails | fails | reported as new |

In a generate run, the component's look is what is changing, so its diffs go to the person, not to the agent. A diff in another component is a side effect, and blocks.

## Lifecycle

### A new component

1. `fazon generate button`: no story has a baseline, so the visual check reports every story as new.
2. The judge looks at them (from M3), and the developer reads the report.
3. The developer accepts the result and runs `fazon baseline update button`.
4. The baselines are committed with the component. In the pull request, the reviewer sees each new image and accepts it with the pull request.

### An intended change to a component

1. The developer changes the spec and runs `fazon generate button`. The component's diffs are advisory; the report shows each changed story with its baseline, its capture and a diff image.
2. The developer accepts the new look and runs `fazon baseline update button`, which writes the changed and new stories and removes the orphans.
3. The pull request shows the image diffs.

### A token change

1. The developer changes the tokens and runs `fazon verify`. Every component the change moves fails with `changed`.
2. The developer reads the diffs in the report and runs `fazon baseline update` for the components that moved as intended, or `--all`.
3. The pull request shows which components moved.

### An unintended change

`fazon verify` or CI fails with `changed`, and the diff image shows where. The fix is in the code; the baseline stays.

### Orphans

A baseline whose story no longer exists, because a fixture, axis, value or state was renamed or removed, or because the component's spec was deleted, is an **orphan**. The visual check fails on it (`orphan`), and `fazon baseline update` removes it.

When an orphan and a new story of the same component and theme have identical pixels, the report and the CI summary pair them as **renamed**, so nobody reviews an unchanged image twice.

### Image upgrades

A framework upgrade can bring a new verifier image, with another browser or fonts, which moves pixels in many stories at once. When the running image isn't the one in `fazon.json`, the visual check compares nothing and fails with one finding (`image`): the baselines were made with another image. The fix is `fazon baseline update --all` in the upgrade's pull request, which records the new image. Single components can't be re-baselined with a different image, so the directory never mixes images.

## In CI

The reusable workflow (T-0032) treats baselines as read-only:

1. It renders every story in the verifier image and compares each with its committed baseline. Any `changed`, `orphan` or `image` finding fails the check; a new story doesn't.
2. It lists the baselines the pull request adds, changes, removes or renames against the base branch. The judge looks at the stories of added and changed baselines ([judge](judge.md#when-the-judge-runs)).
3. The job summary lists those baselines by component, and the report artifact shows each changed one before and after.

CI never writes, updates or commits a baseline, and no bot commits to `main`.

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| BASELINE-001 | Every file in the baselines directory is `fazon.json` or a PNG at a story's baseline path. | the visual check (`orphan`) |
| BASELINE-002 | `fazon.json` is valid against its schema, and names the image the check runs in. | the visual check (`image`) |
| BASELINE-003 | `fazon baseline update` writes only from a run that meets the four conditions in [Writing baselines](#writing-baselines). | the CLI |
| BASELINE-004 | Nothing but `fazon baseline update` writes into the baselines directory: not the agent, not CI. | the harness ([PERM-002](agent-permissions.md#rules)), the reusable workflow |

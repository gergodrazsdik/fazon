# Config file reference

The file that configures Fazon in a consumer repository: its name and format, every key with its default, local overrides, and how it's validated. Decisions behind it: [ADR 0014](../adr/0014-config.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0029.

## The file

`fazon.yaml`, at the repository root, committed. It's YAML, validated against a JSON Schema ([schema](schemas/config.schema.json)). It holds data only: nothing executes code to read it. Editors with the YAML language server validate and complete it from a header line:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/gergodrazsdik/fazon/main/docs/spec/schemas/config.schema.json
---
fazon: 0
adapter: vue
image: ghcr.io/gergodrazsdik/fazon-verifier@sha256:4f1c2a9e7b0d3c58a6e21f9047bd8c3e5a1f6d2b9c7e0a4f8d3b6c1e9a2f5d70
```

That is a [complete, minimal file](examples/config/minimal/fazon.yaml). The [full example](examples/config/full/fazon.yaml) lists every key with its default. From M5, the published schema's URL names the framework version rather than `main`.

The file never holds credentials. The API key comes from the environment (`ANTHROPIC_API_KEY`), never from a file Fazon reads ([brief](../design/brief.md#authentication)).

## Keys

| Key | Default | Meaning |
|---|---|---|
| `fazon` | required: `0` | The config format version. |
| `adapter` | required | The framework adapter: `vue` in version 1. |
| `image` | required | The verifier image, by digest. `fazon init` and framework upgrades write it; changing it means a full re-baseline ([baseline lifecycle](baseline-lifecycle.md#image-upgrades)). |
| `paths.specs` | `specs` | The component specs ([spec format](spec-format.md#files)). |
| `paths.components` | `src/components` | The components directory; each component has `<name>/` in it ([agent permissions](agent-permissions.md#paths)). |
| `paths.entry` | `src/index.ts` | The package entry file the harness maintains. |
| `paths.tokens` | `tokens/tokens.resolver.json` | The token set's resolver document ([token set](tokens.md#files)). |
| `paths.tokensCss` | `src/tokens.css` | The CSS that `fazon sync` builds from the token set ([the build](tokens.md#the-build)). |
| `paths.conventions` | `docs/conventions.md` | The conventions doc. |
| `paths.baselines` | `baselines` | The baselines directory ([baseline lifecycle](baseline-lifecycle.md#where-baselines-live)). |
| `tokens.prefix` | none | The prefix of the token set's custom properties, in lowercase kebab-case: with `fz`, `color.action.primary` is `--fz-color-action-primary` ([custom properties](tokens.md#custom-properties)). |
| `icons` | `lucide` | The fixture icon set ([story matrix rules](story-matrix.md#content)): `lucide`, or `{ path: <directory> }` with one SVG file per icon name. |
| `loop.iterations` | `5` | Agent calls per run ([loop and caps](loop-and-caps.md#caps)). |
| `loop.budgetUsd` | `10` | Cost per run, in USD. |
| `loop.runMinutes` | `90` | Wall-clock time per run. |
| `loop.callMinutes` | `20` | Wall-clock time per agent call. |
| `loop.escalateAfter` | `2` | Failed iterations before the escalation model ([escalation](loop-and-caps.md#escalation)). |
| `models.generator` | `claude-sonnet-5-5` | The model that starts each run. |
| `models.escalation` | `claude-opus-5-5` | The model after escalation. |
| `models.judge` | `claude-sonnet-5-5` | The judge's model ([judge](judge.md#model-and-settings)). |
| `effort.generator`, `effort.escalation`, `effort.judge` | each model's default | Effort per role: `low`, `medium`, `high`, `xhigh` or `max`. |
| `judge.policy` | `advisory` | The judge in CI: `advisory`, `blocking` or `off` ([authority and policy](judge.md#authority-and-policy)). `off` also lets baselines be accepted without a judge verdict. |
| `judge.ciBudgetUsd` | `3` | The judge's cost cap per CI workflow run. |
| `judge.repeats` | `1` | Calls per batch, by majority vote. |
| `prices.<model>` | the framework's price table | `input`, `output`, `cacheRead`, `cacheWrite`, in USD per million tokens, used to cost judge calls. |

Paths are relative to the repository root and may not contain `..`. Unknown keys are errors, so a typo never silently falls back to a default.

## Local overrides

A developer may put a few settings in `fazon.local.yaml`, next to `fazon.yaml` ([schema](schemas/config-local.schema.json), [example](examples/config/local/fazon.local.yaml)). The file is gitignored and never committed, and it may hold only:

- `loop`: the caps and the escalation threshold;
- `models` and `effort`;
- `judge.localPolicy`: `off` to skip the judge in local runs, or `on`.

It can't change paths, the image, the adapter, prices or the CI judge policy. Each override is listed in the run record's `config`, so a local result can always be told apart from a default one. Measured runs and CI refuse to start while the file exists.

With `judge.localPolicy: off`, `fazon baseline update` refuses to write baselines, as their stories weren't judged ([writing baselines](baseline-lifecycle.md#writing-baselines)). `fazon init` adds the file to `.gitignore`.

Settings are applied in this order: the framework's defaults, then `fazon.yaml`, then `fazon.local.yaml`.

## Validation

Every `fazon` command reads and validates the config before it does anything else.

| Rule | What must hold |
|---|---|
| CONFIG-001 | `fazon.yaml` exists and is valid against its schema; unknown keys are errors. |
| CONFIG-002 | Every path exists, except `paths.baselines`, which is created by the first baseline update. |
| CONFIG-003 | `image` is the digest of a verifier image that the CLI's framework version supports. |
| CONFIG-004 | `fazon.local.yaml`, if present, is valid against its schema; measured runs and CI stop when it's present. |
| CONFIG-005 | A model named in `models` has a price, from the config or the framework's table. |

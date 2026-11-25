# Story matrix rules

How the harness turns a component spec into stories, how each state is produced, what a story renders, how it's captured, and how stories and baselines are named. The stories of one spec are written to a **story manifest**, whose JSON Schema is [schemas/story-manifest.schema.json](schemas/story-manifest.schema.json); the expected manifests of the example specs are in [examples/manifests/](examples/manifests/). Decisions behind the rules: [ADR 0006](../adr/0006-story-matrix.md).

- Version: **0**, with the [spec format](spec-format.md); it may change in any pull request until Fazon 1.0.
- Tracker: T-0021.

## Scope

The rules here decide which stories exist and what each one shows. These parts are defined elsewhere:

| What | Defined in |
|---|---|
| What each check does with a rendered story | Check catalogue (T-0022) |
| When a baseline is created, updated or renamed | Baseline lifecycle (T-0023) |
| That the agent never edits stories or the manifest | Agent permission model (T-0024) |
| How the judge's crops are batched | Judge (T-0026) |
| The baselines directory, an icon set of the consumer's own | Config file reference (T-0029) |
| How an adapter writes story files from the manifest | Adapter boundary (T-0031) |
| The themes, from the token set; the `data-part` and state attribute rule | Token set and conventions doc (T-0033) |

## From spec to screenshots

1. The harness reads the spec and writes its manifest, by the rules below.
2. The adapter writes the component's story files from the manifest. Both are generated files: they are rewritten whenever the spec changes, and nobody edits them by hand.
3. The static Storybook build contains the stories.
4. The verifier reads the manifest and Storybook's story index, renders each story in each theme, performs the story's input steps, and captures it. The rendered checks, the baselines and the judge all use these captures.

## Stories

A story is one point of the matrix: a **fixture**, a **value for every axis**, and a **state**. The theme isn't part of a story: every story renders in every theme.

### Axes

The axes are the props in `matrix.axes`, in that order.

- An enum axis takes its values in the order the spec lists them; a boolean axis takes `false`, then `true`.
- An axis's default value is the prop's `default`, or its first value when it has none.
- An axis `<Part>.<prop>` sets the prop on every instance of the part.

### States

The states are the component's `states`, then each part's `states` in the order the parts are declared. `default` is one state shared by all of them: the story with nothing applied. A state whose recipe says `story: false` gets no story.

### Fixtures

The fixtures are those in `matrix.fixtures`; without it, the spec's first fixture. The **first fixture** is the first of them. A [forced story](#forced-stories) may also render another fixture of the spec. A spec with no fixtures renders an empty fixture, which SPEC-009 allows only when no prop or slot is required.

### Expansion: three grids

The stories are the union of three grids:

| Grid | Fixture | Axes | State |
|---|---|---|---|
| **axes** | the first | every combination of values | `default` |
| **states** | the first | every value of the first axis; the other axes at their defaults | every state other than `default` |
| **fixtures** | each other fixture | all at their defaults | `default` |

Without axes, each grid has one axis combination: none. The grids don't overlap: only the axes grid has `default` with the first fixture.

### Forced stories

The grids leave combinations out by design. A spec forces a story they don't make with an entry in `matrix.include`:

- `fixture`: any fixture of the spec; the first fixture when left out;
- `props`: values of axes; the other axes keep their defaults;
- `state`, with `part` for a part's state: `default` when left out. The state is produced as in any other story, even when its recipe says `story: false`.

```yaml
matrix:
  axes: [variant, size]
  fixtures: [label, with-icon, long-label]
  include:
    - props: { variant: ghost, size: lg }
      state: hover
```

This adds `button--label--variant-ghost--size-lg--hover`. A forced story belongs to the **include** grid, and the judge sees it in every theme. An entry that names a story a grid already makes, or one that an `exclude` condition drops, fails SPEC-017.

### Order

The manifest lists the stories in this order: the axes grid in product order (the first axis changes slowest), then the states grid (states in order, each with the first axis's values in order), then the fixtures grid (fixtures in order), then the include grid (in the order of `matrix.include`).

### Exclusions

A story is dropped when it matches a condition in `matrix.exclude`. It matches when:

- the condition's `state`, if any, is the story's state, of the condition's `part` (or of the component when the condition names no part);
- every prop in the condition's `props` has that value in the story. A prop's value in a story is its axis value; otherwise the value the state sets; otherwise the fixture's value; otherwise its default.

### Counts

The example specs give:

| Spec | Axes grid | States grid | Fixtures grid | Stories (with include) | Captures in two themes | Judge crops |
|---|---|---|---|---|---|---|
| [Button](examples/specs/valid/button.md), with one forced story | 9 | 15 | 2 | 27 | 54 | 37 |
| [Tabs](examples/specs/valid/tabs.md) | 2 | 4 | 2 | 8 | 16 | 10 |
| [Dialog](examples/specs/valid/dialog.md) | 3 | 7 | 1 | 11 | 22 | 14 |

## Producing states

The first rule that applies produces a state:

1. **`default`:** nothing.
2. **A recipe** in the spec's `produce`: its `props` are set and its `input` steps performed.
3. **A boolean prop with the state's name**, such as `disabled` or `loading`: set to `true`.
4. **A pseudo-state**, produced by real input:
   - `hover`: the `hover` action;
   - `focus-visible`: the `focus` action;
   - `active`: the `pointer-down` action.
5. Otherwise the state can't be produced, and the spec fails SPEC-015.

Props are applied in order: the fixture, then the axis values, then the state's props, so the state wins.

### Targets

A state of the component applies to its root. A state of a part applies to one instance of the part:

- the instance a recipe's `instance` names;
- otherwise, for props, the first instance;
- otherwise, for pseudo-states, `<Part>[default]`: the first instance that has no [reflected state](#reflected-states) once the story has rendered. In the Tabs example, a hovered Trigger is the second one, because the first is selected.

### Input actions

| Action | What the verifier does |
|---|---|
| `hover` | Moves the pointer to the centre of the target. |
| `focus` | Presses Tab once, then focuses the target, so the browser treats it as keyboard focus and `:focus-visible` matches. Focusing has its real effects: a Tabs Trigger with automatic activation becomes selected. The verifier's tests in M1 confirm this in the pinned browser. |
| `pointer-down` | Moves the pointer to the centre of the target and holds the primary button down until the capture. |
| `click` | Clicks the centre of the target, then moves the pointer to the top-left corner of the viewport. |
| `press` | Presses and releases `key` in the focused element. |
| `scroll` | Scrolls the target to its `start` or `end`. |

After the last step, the verifier waits until the layout is stable before capturing it.

### Reflected states

Two attributes let the verifier find elements and know their state:

- The component's root element carries `data-part="<Component>"`, and each part's root element carries `data-part="<Part>"`.
- Every state that isn't a pseudo-state is **reflected**: while an element is in the state, it carries the attribute `data-<state>` (for example `data-selected`, `data-disabled`).

The verifier uses them to find targets, to pick `<Part>[default]`, to know each element's state when it applies token rules and exemptions, and to confirm that a `story: false` state is shown. The rule becomes part of the conventions doc (T-0033), and a check confirms it (MATRIX-004, MATRIX-005). Attributes a headless library sets, such as Reka UI's `data-state`, are unaffected.

## Content

- Stories render fixtures only: the agent doesn't choose what a story shows.
- **Icons:** the fixture icon set is [Lucide](https://lucide.dev), from the `lucide-static` npm package (ISC license), at a version the framework pins from M1. Icon names in fixtures are Lucide's, such as `check`, `x` or `chevron-down`. A consumer can replace the set with a directory of their own SVG files through the config file (T-0029). An icon name that isn't in the set in use fails SPEC-009.
- Text is English. Right-to-left layouts are out of scope for version 1.
- Fonts come from the verifier image.

## Rendering

Every rendered check uses the same conditions:

- **Viewport:** 1024 by 768 CSS pixels at a device scale factor of 2. One render serves both the baselines and the judge's 2x crops. A full-viewport capture is 2048 by 1536 pixels, about 4,000 visual tokens.
- **Frame:** the story renders inside a frame element generated with the story, with 16 px of padding. The frame is as wide as the fixture's `frame.width`, or fits its content when there's none.
- **Theme:** the verifier selects a theme the way the token build expects, for example `data-theme="dark"` on the document root.
- **Motion:** `prefers-reduced-motion: reduce`. Animations and transitions are finished before the capture, and the text caret is hidden.
- **Readiness:** before input, the story has rendered and its fonts have loaded. After input, the layout is stable.

## Capture

- The capture is the frame's box, joined with the boxes of the parts marked `portal` that are rendered, and clipped to the viewport.
- When a rendered portal part covers the whole viewport, such as an overlay, the capture is the whole viewport.
- Captures are PNG files at the device scale factor.

## Themes

Every story renders in every theme of the token set; the first theme is the default.

- The deterministic checks run, and baselines are kept, for every story in every theme.
- The judge sees every story in the default theme, and the axes and include grids in the other themes. The manifest's `judge` field lists the themes for each story.

## Names

A story's name is:

```text
<component>--<fixture>--<axis>-<value>--…--<state>
```

- `<component>` is the component name in kebab-case.
- Every axis appears, in the order of `matrix.axes`, as the prop name in kebab-case; an axis `<Part>.<prop>` is written `<part>-<prop>`. Values are written as in the spec; booleans as `true` and `false`.
- `<state>` is `default`, the component's state, or `<part>-<state>` for a part's state.

For example: `button--label--variant-primary--size-md--hover`, `tabs--three--orientation-horizontal--trigger-focus-visible`, `dialog--confirm--content-size-md--closed`.

A baseline's path, inside the baselines directory, is `<theme>/<component>/<story name without "<component>--">.png`, for example `dark/button/label--variant-primary--size-md--hover.png`.

In Storybook, the stories' title is the component name, and the adapter chooses the export names. The manifest records the ID Storybook derives from them (`storybookId`), and the verifier opens each story by that ID.

A change to a fixture's name, an axis, a value or a state renames stories; what happens to their baselines is defined in the baseline lifecycle (T-0023).

## The manifest

One JSON file per component, written by the harness ([schema](schemas/story-manifest.schema.json)):

| Field | Content |
|---|---|
| `fazon` | The manifest format version: `0`. |
| `component`, `spec` | The component name, and the spec's path. |
| `themes` | The token set's themes; the first is the default. |
| `viewport` | `width`, `height` and `scale`. |
| `fixtures` | The fixtures the stories render, including those only forced stories use, with `extends` merged. |
| `stories` | The stories, in order. |

Each story has:

| Field | Content |
|---|---|
| `name`, `storybookId` | Its [names](#names). |
| `grid` | `axes`, `states`, `fixtures` or `include`. |
| `fixture`, `axes`, `state` | Its point in the matrix; `state` has a `name` and, for a part's state, the `part`. |
| `set` | Prop values set over the fixture, in order: axis values, then the state's props. Each entry has a `target`: `root`, `<Part>[<n>]`, `<Part>[*]` (every instance) or `<Part>[default]`. |
| `input` | The input steps, with targets in the same form. |
| `judge` | The themes in which the judge sees it. |

## Validation

| Rule | What must hold | Checked by |
|---|---|---|
| MATRIX-001 | The manifest is valid against its schema. | the harness, when it writes the manifest |
| MATRIX-002 | No two stories share a name or a `storybookId`. | the harness |
| MATRIX-003 | Every `storybookId` is in the Storybook build's story index, and the index has no other story of the component. | the verifier, before the checks |
| MATRIX-004 | The root and every rendered part carry `data-part`, and every target in `set` and `input` resolves to an element. | the verifier |
| MATRIX-005 | A state set by props is reflected on its target; a state with `story: false` is reflected by at least one element in the component's stories. | the verifier |

A failed rule fails the run: the harness or verifier reports it, and no check result for the component counts.

## Examples

The [manifests](examples/manifests/) of the three valid example specs, written by these rules: [Button](examples/manifests/button.json), [Tabs](examples/manifests/tabs.json) and [Dialog](examples/manifests/dialog.json). `just lint` checks them against the schema; from M2 they are the expected output of the harness for those specs.

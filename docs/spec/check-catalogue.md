# Check catalogue

The deterministic checks that verify a component, with one rule sheet per check: its scope, its rules, the values it allows, how an exemption applies to it, and its fixtures. Every check blocks: a finding that no exemption waives fails the component. Decisions behind the catalogue: [ADR 0007](../adr/0007-check-catalogue.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0022.

## Scope

| What | Defined in |
|---|---|
| Which stories the rendered checks see, how states are produced and captured | [Story matrix rules](story-matrix.md) |
| How a spec waives a check | [Spec format: exemptions](spec-format.md#exemptions) |
| When a baseline is created or updated | [Baseline lifecycle](baseline-lifecycle.md) |
| Which commands the agent may run itself | [Agent permission model](agent-permissions.md) |
| What the loop does with findings | [Loop and caps](loop-and-caps.md) |
| How findings are stored | [Run records and provenance](records.md) |
| The commands an adapter supplies for the source checks, and how it reads a component's API | [Adapter boundary](adapter-boundary.md) |
| Which tokens are role tokens, their custom property names, the base styles | [Token set](tokens.md) |

## The checks

| ID | Kind | Catches | Tooling |
|---|---|---|---|
| [`build`](#build) | source | code that doesn't compile, type errors, a Storybook that doesn't build | the adapter's build and type-check commands (Vite, vue-tsc for Vue), Storybook |
| [`lint`](#lint) | source | style violations, raw values in place of tokens, raw tokens, inline suppressions | ESLint, Stylelint with Fazon's token rules |
| [`test`](#test) | source | an API that differs from the approved one, wrong behaviour, events, keyboard handling | Vitest in browser mode |
| [`package`](#package) | source | a missing export, styles left out, broken type declarations | library build and pack, publint, Are the Types Wrong |
| [`a11y`](#a11y) | rendered | missing roles and names, low contrast, a role or name that differs from the spec | axe-core through Playwright, the accessibility tree |
| [`tokens`](#tokens) | rendered | a style that doesn't come from a role token, or not from the token the spec names | Playwright, the CSS declarations that apply to each element |
| [`layout`](#layout) | rendered | content that spills or is clipped, unexpected scrolling, targets under 24 px | Playwright, element boxes |
| [`visual`](#visual) | rendered | an unintended change against a baseline | Playwright screenshots, pixel comparison |

## Common rules

### Where checks run

Every check runs inside the verifier image, with dependencies installed in the image, never taken from the host. Before any check, the verifier confirms that the Playwright version in the consumer's lockfile is the one the image carries; a mismatch is an error, and no check runs. Checks use no network.

### Order and results

1. `build` runs first. Then `lint`, `test` and `package`, and, from the Storybook build, the rendered checks.
2. Every check that can run does, so a run reports all its findings at once. A check whose input a failed check didn't produce is **skipped**: the rendered checks need the Storybook build, and `package` needs the library build.
3. Each check ends as **pass** (no unwaived finding), **fail**, **skipped**, or **error** (the check itself couldn't run, for example a crashed browser). Only pass counts as passing.
4. Warnings count as errors: a tool's warning is a finding of the rule it belongs to.

### Findings

A finding has:

- `check` and `rule`: the IDs from this catalogue;
- `message`: what is wrong, in plain words;
- a location: `file`, `line` and `column` for a source check; `story`, `theme`, `part` and a CSS `selector` for a rendered check;
- `expected` and `actual`, where the rule compares values;
- `evidence`: a file that shows it, such as a diff image;
- `exempt`: whether an exemption waives it, and which.

The [run record](records.md#the-run-record) stores findings in this shape.

### Exemptions

An exemption in the spec waives the findings of one `check` and `rule`:

- **Source checks** (`build`, `lint`, `test`, `package`): an exemption applies to all of the component's files, and names no `part`, `fixture` or `when` (SPEC-012).
- **Rendered checks:** an exemption applies to the findings that match all it names:
  - `part`: the finding's element is in that part, meaning its nearest ancestor-or-self with `data-part` is the part;
  - `fixture`: the finding's story renders that fixture;
  - `when`: the story's prop values and state match the condition.

A waived finding stays in the report, marked exempt. An exemption that waived nothing in a run is listed as unused in the report; it doesn't fail the run.

### No inline suppressions

Component files carry no inline suppressions, such as `eslint-disable`, `stylelint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or vue-tsc's `@vue-ignore`, `@vue-expect-error` and `@vue-skip`: the `lint` rule `inline-suppression` fails them. A check is waived only by an exemption in the spec, which the reviewer sees. Lint configuration belongs to the framework and the consumer, not to a component; a rule of ESLint's or Stylelint's own can't be exempted for one component.

### Token-bound properties

`lint` and `tokens` check the same properties, which must take their values from role tokens:

| Group | Properties (with their sides, corners and logical forms) |
|---|---|
| Colour | `color`, `background-color`, `border-color`, `outline-color`, `text-decoration-color`, `caret-color`, `accent-color`, `fill`, `stroke`, `column-rule-color` |
| Spacing | `padding`, `margin`, `gap`, `row-gap`, `column-gap` |
| Shape | `border-radius`, `border-width`, `outline-width`, `outline-offset` |
| Type | `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing` |
| Elevation | `box-shadow` |
| Motion | `transition-duration`, `transition-delay`, `transition-timing-function`, `animation-duration`, `animation-delay`, `animation-timing-function` |

A value is valid when it is a role token's custom property (`var(--color-action-primary)`, with the [prefix](tokens.md#custom-properties) if one is set), a component-local custom property whose value is valid, or one of the **allowed values**: `0` (with any unit), `auto`, `none`, `normal`, `inherit`, `initial`, `unset`, `revert`, `currentColor`, `transparent` and `100%`. Inside `calc()`, `min()`, `max()` and `clamp()`, every operand is a valid value or a unitless number. Positioning (`top`, `left`, `inset`, `transform`), sizing (`width`, `height`) and the inline styles a headless library sets for positioning are out of scope.

- **Shorthands** are checked on the token-bound properties they set. When a shorthand uses `var()` and its parts can't be told apart (`border`, `font`, `transition`), only literals that look like a token's value count as raw values.
- **Fallbacks:** a `var()` fallback is checked like any other value.
- **Prefixes and at-rules:** a vendor-prefixed property counts as the unprefixed one; `@font-face` descriptors aren't token-bound.
- **Framework bindings:** a value bound from the component's code, such as Vue's `v-bind()` in a `<style>` block, is a raw value (`raw-value`).
- **Local properties:** a `--_` property the component doesn't declare is `unknown-token`.

## build

**Scope:** the component's code, built as part of the consumer's library, type-checked, and built into the static Storybook.

| Rule | Fails when |
|---|---|
| `compile` | The library build fails. |
| `types` | The type-check reports an error. The type-check configuration is the adapter's, in strict mode; the agent doesn't change it. |
| `storybook` | The static Storybook build fails. |
| `generated` | The committed generated files (story files, contract tests, story manifest, the token CSS) differ from what the harness generates from the committed spec ([agent permissions](agent-permissions.md#files-the-harness-maintains)). |

**Allowed:** nothing; every error and warning is a finding.

**Fixtures** (with the Vue adapter, in M1): pass, a component that builds and type-checks cleanly; fail, a component that passes a string to a `number` prop (`types`).

## lint

**Scope:** the component's files: script, template and styles. The lint configuration is the adapter's, with Fazon's rules added.

| Rule | Fails when |
|---|---|
| `raw-value` | A [token-bound property](#token-bound-properties) is declared with a literal that isn't an allowed value, such as `#2050d0` or `12px`. |
| `raw-token` | A declaration references a raw token's custom property instead of a role token's. |
| `unknown-token` | A declaration references a custom property that is neither a token nor a component-local property. |
| `inline-suppression` | A file carries an [inline suppression](#no-inline-suppressions). |
| `eslint`, `stylelint` | Any other rule of the ESLint or Stylelint configuration reports a problem; the finding names that rule. These can't be exempted. |

**Allowed:** the allowed values above.

**Fixtures** (M1): pass, a component whose styles use only role tokens; fail, `background-color: #2050d0` (`raw-value`).

## test

**Scope:** two kinds of tests, run with Vitest in browser mode in the verifier:

- **Contract tests,** generated by the harness from the spec and its approved API. The agent can't edit them. They check that:
  - the component's props, events, slots, methods and two-way bindings match the approved API, with the adapter's mapping and the spec's extensions applied, including types, defaults and required props (the adapter reads the API: [adapter boundary](adapter-boundary.md#contract-tests));
  - every story renders without an error or warning in the console.
- **Behaviour tests,** written by the agent next to the component, for the spec's `## Behaviour` and keyboard map.

| Rule | Fails when |
|---|---|
| `contract-api` | The component's API differs from the approved API. |
| `contract-render` | A story logs an error or warning, or throws, while it renders. |
| `behaviour` | A behaviour test fails. |
| `missing-behaviour` | The component has no behaviour test. |

**Allowed:** nothing.

**Fixtures** (M1): pass, a Button whose API matches its spec, with one passing behaviour test; fail, the same Button with its `size` default changed to `lg` (`contract-api`).

## package

**Scope:** the consumer's component package, built and packed as it would be published. Findings name the component they concern when they can.

| Rule | Fails when |
|---|---|
| `export` | A component or one of its parts isn't exported from the package entry, or the export doesn't resolve from the packed tarball. |
| `types` | An export's type declarations are missing or don't resolve (Are the Types Wrong, with the resolution the adapter names: bundler resolution for Vue). |
| `styles` | A component's styles aren't in the packed output, or don't load when the component is imported. |
| `manifest` | The package's `package.json` isn't valid for publishing (publint). |

**Allowed:** nothing.

**Fixtures** (M1): pass, a package whose entry exports Button; fail, a package whose entry leaves Button out (`export`).

## a11y

**Scope:** every story in every theme. axe-core runs on the component's elements (the root and its rendered portal parts), with the rules tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`. Rules about a whole page don't apply to a story and are off: `region`, `landmark-one-main`, `page-has-heading-one`, `bypass`, `document-title` and `html-has-lang`.

| Rule | Fails when |
|---|---|
| *an axe rule ID*, such as `color-contrast` or `button-name` | axe reports a violation of that rule. |
| `spec-role` | An element's computed role differs from its `a11y.role` in the spec. |
| `spec-name` | An element's accessible name or description doesn't come from where `a11y.name` and `a11y.describedBy` say: its content, the prop's value, the named part, or none. |
| `spec-aria` | An ARIA attribute listed in `a11y.aria` appears on its element in none of the component's stories. |

axe's undecided results ("incomplete", for example contrast over a gradient) don't fail: they are listed in the report and the pull request summary for a person to look at. Contrast is checked in every theme, as every story renders in every theme.

**Allowed:** nothing beyond the rules that are off.

**Fixtures:** [pass](examples/checks/a11y/pass.html), a labelled button; [fail](examples/checks/a11y/fail.html), an icon-only button with no accessible name (`button-name`).

## tokens

**Scope:** every story in every theme. For each element of the component and each [token-bound property](#token-bound-properties), the verifier reads the declaration that wins the cascade, through the Chromium DevTools protocol, and follows its custom properties to the token they name.

| Rule | Fails when |
|---|---|
| `raw-value` | The winning declaration is a literal that isn't an allowed value. |
| `raw-token` | It resolves to a raw token instead of a role token. |
| `unknown-token` | It references a custom property that is neither a token nor a valid component-local property. |
| `user-agent` | No author declaration applies, and the browser's own stylesheet sets a value that isn't allowed, such as a button's default padding or its system font (`font: -webkit-small-control`). |
| `token-rule` | A [token rule](spec-format.md#tokens) in the spec applies to the element, and the declaration resolves to a different token. |

A property that no stylesheet sets keeps its initial value, which isn't a finding. An inherited value is checked on the element that declares it; values inherited from outside the component come from the story frame's base styles.

**Allowed:** the allowed values above.

**Fixtures:** [tokens](examples/checks/tokens/tokens.json) for both; [pass](examples/checks/tokens/pass.html), a button styled with role tokens only; [fail](examples/checks/tokens/fail.html), its background taken from a raw token (`raw-token`).

## layout

**Scope:** every story in every theme, measured on the rendered boxes of the component's elements.

| Rule | Fails when |
|---|---|
| `overflow` | Content extends outside an element whose `overflow` is `visible`, or the component's root extends outside the frame. |
| `clipped-text` | Text is cut off: an element that hides or clips overflow, or truncates text with an ellipsis or a line clamp, has more text than it shows. |
| `scroll` | An element scrolls: its content is larger than its box and its `overflow` is `auto` or `scroll`. Intended scrolling is declared with an exemption, so the reviewer sees it. |
| `target-size` | An interactive element fails [WCAG 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum): it is smaller than 24 by 24 CSS pixels, and a 24 px circle centred on it intersects another target, or another undersized target's circle. Inline targets in a line of text are excepted, as WCAG excepts them. |

An interactive element has a role of `button`, `link`, `tab`, `checkbox`, `radio`, `switch`, `menuitem`, `option`, `combobox`, `textbox`, `searchbox` or `slider`, or is in the tab order.

**Allowed:** nothing.

**Fixtures:** [pass](examples/checks/layout/pass.html), a long label that wraps in a 160 px frame; [fail](examples/checks/layout/fail.html), the same label on one line, clipped with an ellipsis (`clipped-text`).

## visual

**Scope:** every story in every theme, compared with its committed baseline (named by the [story matrix rules](story-matrix.md#names)).

| Rule | Fails when |
|---|---|
| `changed` | The capture differs from its baseline beyond the tolerance, or has a different size. The finding's evidence is a diff image. |
| `orphan` | A file in the baselines directory belongs to no story, or isn't a baseline. |
| `image` | The verifier image running the check isn't the one recorded with the baselines; nothing is compared. The images are compared by digest; baselines without a `fazon.json` count as made by another image. |

A story without a baseline is reported as **new**, and doesn't fail. None of these rules can be exempted. In `fazon generate`, the component being generated has its `changed` and `orphan` findings shown to the person but not to the agent. The [baseline lifecycle](baseline-lifecycle.md) says how baselines are made, changed and removed.

**Platform:** captures are made only on linux/amd64, the platform of CI's runners, in headless Chromium with software rendering, the browser and fonts the verifier image pins. On another architecture the image runs emulated.

**Tolerance:** two pixels differ when their colour distance exceeds 0.1 (pixelmatch 8's threshold: the HyAB distance in OKLab, on a scale of 0 to 1; version 7 measured in YIQ, so the version is pinned with the image); anti-aliased pixels are not excluded. No differing pixel is allowed. M1 renders every example story repeatedly to measure whether this holds; any change to the tolerance is recorded in an ADR.

**Fixtures:** the verifier renders [base](examples/checks/visual/base.html) as the baseline; [pass](examples/checks/visual/pass.html) renders the same pixels from different markup; [fail](examples/checks/visual/fail.html) has 1 px more padding (`changed`).

## Fixtures

Each check has a passing and a failing fixture; the framework's own tests run them from M1.

- The rendered checks' fixtures are static HTML pages in [examples/checks/](examples/checks/), framework-neutral like the checks. Each page renders a component root with `data-part` inside a frame element, and names the result it expects in a comment: `fazon-fixture: check=<check> expect=<rule>`, or `expect=pass`.
- Each fixture runs through its own check only.
- The source checks' fixtures are framework-specific; they arrive with the Vue adapter in M1, as described in each sheet.

The fixtures' token names come from the example library's [draft token set](example-library/README.md), with no prefix, and their frames set the [base styles](tokens.md#base-styles).

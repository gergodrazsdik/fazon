# Token set

How a token set is written and built: the files and the part of the token format Fazon supports, raw and role tokens, themes, the custom property names, the CSS the build writes, and the story frame's base styles. The example library's own token set and conventions doc are drafts in [example-library/](example-library/README.md). Decisions behind them: [ADR 0018](../adr/0018-token-set.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0033, Q-0007.

## Scope

| What | Defined in |
|---|---|
| Which properties take their values from role tokens, and the values allowed without one | [Check catalogue](check-catalogue.md#token-bound-properties) |
| Token rules in a spec | [Spec format](spec-format.md#tokens) |
| Rendering in each theme | [Story matrix rules](story-matrix.md#rendering) |
| The paths and the prefix | [Config file reference](config.md#keys) |
| The example library's token set and conventions doc | [Example library drafts](example-library/README.md) |

## Files

A token set is a [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/) **resolver document** and the token files it names, under `tokens/` by default:

```text
tokens/
  tokens.resolver.json    the entry point: paths.tokens in fazon.yaml
  raw.json                raw tokens
  roles.json              role tokens that are the same in every theme
  themes/
    light.json            role tokens for the light theme
    dark.json             role tokens for the dark theme
```

The resolver document ([schema](schemas/token-resolver.schema.json)) uses a subset of the [resolver module](https://www.designtokens.org/tr/2025.10/resolver/):

- `sets`: named sets, each a list of token files by relative path;
- `modifiers`: one modifier, `theme`, with one context per theme and a `default`;
- `resolutionOrder`: the sets, then `#/modifiers/theme` last.

Files are referenced with `$ref` and a relative path; there are no inline tokens, and no other modifier in version 0. A brand or density modifier would multiply the themes, and waits until a library needs one.

## The format

Each token file ([schema](schemas/tokens.schema.json)) uses this subset of the [format module](https://www.designtokens.org/tr/2025.10/format/), which Style Dictionary 5.8 builds (Q-0007):

| `$type` | `$value` |
|---|---|
| `color` | `{ "colorSpace": "srgb", "components": [r, g, b], "alpha"?, "hex" }`: components from 0 to 1, and the same colour as `#rrggbb` |
| `dimension` | `{ "value", "unit" }`, with `px` or `rem` |
| `duration` | `{ "value", "unit": "ms" }` |
| `cubicBezier` | `[x1, y1, x2, y2]` |
| `fontFamily` | a name, or a list of names in order of preference |
| `fontWeight` | a number from 1 to 1000 |
| `number` | a number, such as a line height |
| `shadow` | a layer or a list of layers: `color`, `offsetX`, `offsetY`, `blur`, `spread` and an optional `inset` |

- Every token states its own `$type`; groups don't pass a type down.
- A **reference** is a token's dotted path in curly braces, such as `{color.blue.600}`. It can stand for a whole `$value`, or for the colour or a dimension inside a shadow layer. JSON pointer references (`$ref` inside a token file) aren't supported.
- Group and token names are lowercase kebab-case, digits allowed: `color.text.on-action`, `space.0-5`.
- `$description` and `$extensions` are allowed on groups and tokens.
- Not supported: other colour spaces, the composite types `border`, `strokeStyle`, `transition`, `gradient` and `typography`, `$deprecated`, `$root` and group `$extends`. A component sets each property from its own token instead.

The subset grows when a component needs a type and the build supports it.

## Raw and role tokens

The structure says which is which; nothing else marks a token:

- A **raw token** has a literal `$value`: a palette colour, a spacing step. A shadow's layers may reference raw colour tokens.
- A **role token**'s `$value` is a single reference: `color.text.primary` is `{color.neutral.900}`. A role token references a raw token or another role token.

Components reference role tokens only; the `lint` and `tokens` checks fail a raw token in a component (`raw-token`). A spec's token rules name role tokens only (SPEC-011).

Raw tokens live in the sets, never in a theme context. A role token is defined in exactly one place: the theme-independent sets, or every theme context. No role token has the path of a raw token: when the sets merge, the role would replace the raw value and reference itself.

## Themes

A theme is a context of the `theme` modifier. Each context defines the same role tokens, pointing at different raw tokens; nothing else changes between themes. The modifier's `default` names the default theme: the one that applies without a `data-theme` attribute, and the one the judge sees every story in.

Version 1's token sets have `light` (the default) and `dark`. Every story renders in every theme, and the checks run in each ([story matrix rules](story-matrix.md#themes)).

## Custom properties

A token's custom property is `--`, the prefix and a hyphen when there's one, then the token's path joined with hyphens:

| Prefix (`tokens.prefix`) | `color.action.primary` |
|---|---|
| none (the default) | `--color-action-primary` |
| `fz` | `--fz-color-action-primary` |

The prefix keeps a library's properties apart from an app's own. It is lowercase kebab-case. Component-local custom properties start with `--_` ([conventions](example-library/conventions.md#styling)), so they never look like a token.

## The build

`fazon sync` builds the token set into one CSS file, at `paths.tokensCss` (`src/tokens.css` by default), committed with the library. The `build` check's rule `generated` fails when it differs from what the token set builds. The tokens pipeline resolves the resolver document itself and runs Style Dictionary once per theme, as Style Dictionary doesn't read resolver documents yet.

```css
:root {
  /* every raw token, every theme-independent role token, and the default theme's role tokens */
  --fz-color-blue-600: #2154d9;
  --fz-color-action-primary: var(--fz-color-blue-600);
}

[data-theme="light"] {
  /* every theme, the default first: only its role tokens */
  --fz-color-action-primary: var(--fz-color-blue-600);
}

[data-theme="dark"] {
  --fz-color-action-primary: var(--fz-color-blue-400);
}
```

- **Blocks:** `:root` holds every raw token, every theme-independent role token and the default theme's role tokens. Then every theme has a `[data-theme="<theme>"]` block with only its own role tokens: the default theme first, then the others in the order of the theme modifier's contexts.
- **Stable output:** the file starts with a comment saying that `fazon sync` generated it and that it must not be edited. It holds no timestamp or path, so the same token set and prefix always build the same file.
- **References stay references:** a role token's property is `var(...)` of the token it references, so a theme only re-points roles, and the `tokens` check can follow a value to its token.
- **Units:** dimensions keep their unit, durations are written in seconds, colours as hex or `rgba()`, cubic Béziers as `cubic-bezier()`, and font families as a list.
- **Selecting a theme:** `data-theme="<theme>"` on the root element or any ancestor; without it, the default theme applies. A subtree can switch either way: `data-theme="light"` inside a `data-theme="dark"` ancestor applies the light theme again. The build doesn't follow `prefers-color-scheme`. An app that wants to sets the attribute itself. The verifier sets it on the root element.

The library's package ships the file beside its components, exported as `<package>/tokens.css` ([ADR 0021](../adr/0021-settled-questions.md)).

## Base styles

The story frame sets the inherited properties from the token set, so a component inherits role tokens, never the browser's defaults:

| Property on the frame | Role token |
|---|---|
| `background-color` | `color.surface.base` |
| `color` | `color.text.primary` |
| `font-family` | `font-family.body` |
| `font-size` | `font-size.body` |
| `font-weight` | `font-weight.body` |
| `line-height` | `line-height.body` |

The frame also sets `color-scheme` to the theme's name when it is `light` or `dark`. Every token set defines these six role tokens.

## Changing the token set

The token set changes only through a reviewed pull request. After a change, `fazon sync` rebuilds the CSS, and [`fazon verify`](cli.md#fazon-verify) re-renders every story; the visual check shows which components moved, and `fazon baseline update` takes the change in the same pull request.

A run records the token set's hash ([records](records.md#hashes)): the hash of the resolver document and of each token file, in the resolver's order.

## Rules

`fazon sync` refuses to build a token set that breaks a rule, and CI runs `fazon sync --check`.

| Rule | What must hold |
|---|---|
| TOKEN-001 | The resolver document is valid against its [schema](schemas/token-resolver.schema.json), and every file it names exists, can be read, is valid JSON and is valid against the [token file schema](schemas/tokens.schema.json). The theme modifier's `default` is one of its contexts; `resolutionOrder` names `#/modifiers/theme` last and only sets that exist; every `$ref` to a file is relative and contains no `..`. |
| TOKEN-002 | Every reference resolves, to a token of the same `$type`, without a cycle. A shadow layer's references resolve to a colour or a dimension. |
| TOKEN-003 | A token's value is a literal or exactly one reference, never a reference mixed with other text. A raw token's composite value, such as a shadow layer's colour, references raw tokens only. |
| TOKEN-004 | A path is defined once: in one set, or in every theme context. Theme contexts define role tokens only, and all of them the same ones. No path is a token in one place and a group in another. |
| TOKEN-005 | The six tokens of the [base styles](#base-styles) exist in every theme, and each is a role token. |
| TOKEN-006 | No two tokens have the same custom property name. |

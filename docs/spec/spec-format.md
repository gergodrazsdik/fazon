# Spec format

How a component spec is written: one Markdown file per component, with machine-readable front matter and a prose body. The front matter's JSON Schema is [schemas/spec.schema.json](schemas/spec.schema.json); worked examples are in [examples/specs/](examples/specs/). Decisions behind the format: [ADR 0005](../adr/0005-spec-format.md).

- Format version: **0**. Version 0 may change in any pull request until Fazon 1.0 ([README](README.md)); a change updates this document, the schema and the examples together.
- Tracker: T-0020.

## Scope

This document defines what a spec may contain and which rules make it valid. These parts are only hooked in here and defined elsewhere:

| What | Defined in |
|---|---|
| How a state is produced (prop, pseudo-state, interaction), how `matrix` expands into stories, story names, the icon set fixtures draw from | Story matrix rules (T-0021) |
| Check and rule IDs that `exemptions` name, and what each rule allows | Check catalogue (T-0022) |
| How the judge's rubric is built from the body | Judge (T-0026) |
| Where the approved API's hash is recorded, and its canonical form | Run record and provenance schemas (T-0028) |
| Where specs live in a consumer repo, adapter-wide defaults | Config file reference (T-0029) |
| Each adapter's mapping of the neutral API, and its schema for `extensions` | Adapter boundary (T-0031) |
| The token names a spec may reference | Token set (T-0033) |

## Files

- One spec per component, at `specs/<name>.md` in the consumer repo, where `<name>` is the component name in kebab-case: `Button` is `specs/button.md`, `RadioGroup` is `specs/radio-group.md`.
- UTF-8, LF line endings.
- The file starts with YAML front matter between two `---` lines, followed by the Markdown body.
- A multi-part component, such as Tabs or Dialog, is one spec with named parts, not one spec per part.

## Front matter

Every member of the API is written in long form, as a mapping, even when it only has a type. All names follow fixed cases:

| Kind of name | Case | Examples |
|---|---|---|
| Component, part | PascalCase | `Button`, `Trigger` |
| Prop, event, slot, method, parameter | camelCase | `variant`, `asChild`, `default` |
| Enum value, state, fixture, check, rule, adapter ID | kebab-case | `focus-visible`, `long-labels`, `web-components` |
| Token | dotted path, as in the tokens file | `color.action.primary` |

### Top-level fields

| Field | Required | Content |
|---|---|---|
| `fazon` | yes | The format version: `0`. |
| `name` | yes | The component name. |
| `tier` | yes | `primitive`, `form-control` or `composite`. |
| `summary` | yes | One sentence on what the component is for. |
| `reference` | no | A reference image, relative to the spec (`.png`, `.jpg`, `.webp`). The judge sees it. |
| `uses` | no | Other components this one renders or composes, by name. |
| `props`, `events`, `slots`, `methods` | no | The component's [API](#the-neutral-api). |
| `forward` | no | Which element receives undeclared attributes, classes and the ref: `root` (the default) or a part name. |
| `form` | no | [Form participation](#form-participation). |
| `parts` | no | [Named parts](#parts) of a multi-part component. |
| `states` | no | The states stories show, such as `hover` or `disabled`. |
| `a11y` | no | [Accessibility](#accessibility) of the root element. |
| `fixtures` | no | [Content](#fixtures) that stories render. |
| `matrix` | no | [Hooks for the story matrix](#matrix). |
| `tokens` | no | [Token rules](#tokens). |
| `exemptions` | no | [Checks waived](#exemptions) for this component. |
| `extensions` | no | [Framework-specific additions](#extensions). |

No other field is allowed. In particular, the approval of the API isn't recorded in the spec but in the component's provenance file (see [Approval](#approval)).

### Types

A prop, an event payload, a slot's data and a method's parameters and result each have a type:

| `type` | Also needs | Value |
|---|---|---|
| `boolean` | | `true` or `false` |
| `string` | | text |
| `number` | | a number |
| `enum` | `values`: a list of kebab-case values | one of the values |
| `array` | `items`: a type other than `array` | a list |

### The neutral API

The API is written once, framework-neutral. Each adapter maps it to its framework's idioms; what doesn't map goes into [extensions](#extensions).

**`props`**, keyed by name. Each prop has a `type` and optionally:

- `description`;
- `default`, of the prop's type (an enum's default is one of its values);
- `required: true`, for a prop with no default;
- `model: true`, for a two-way bound prop. Its change notification is implied: don't list it under `events`.

**`events`**, keyed by name: `description` and an optional `payload` type. Events are named for what happened (`click`, `dismiss`), not with an `on` prefix.

**`slots`**, keyed by name; `default` is the unnamed slot. Each slot has `description`, `required` and optionally `data`: values the component passes to the slot's content, keyed by name, each with a type.

**`methods`**, keyed by name: `description`, optional `params` (keyed by name, each with a type) and an optional `returns` type. Only for what can't be done through props, such as moving focus.

How the Vue adapter maps the API, and how later adapters are expected to (the [adapter boundary](README.md) document, T-0031, makes this binding):

| Neutral | Vue (version 1) | React | Angular | Svelte | Web Components |
|---|---|---|---|---|---|
| prop | prop | prop | `input()` | prop | property, and an attribute for scalar types |
| `model: true` | `v-model` (`value` maps to `modelValue`), else `v-model:<name>` | `<name>` + `on<Name>Change` + `default<Name>` | `model()`, `[(name)]` | `$bindable` prop | property + change event |
| event | emitted event | `on<Event>` callback prop | `output()` | callback prop | `CustomEvent` |
| slot | slot | `children` or a prop | content projection | snippet | named `<slot>` |
| slot `data` | scoped slot | render prop | `ng-template` with context | snippet parameters | no equivalent: needs an extension |
| method | `defineExpose` | ref with `useImperativeHandle` | public method | exported function | element method |
| part | a component named `<Component><Part>`, such as `TabsTrigger` | the same | the same | the same | a custom element per part |

#### Form participation

`form` says which props make the component a form field, so each adapter can connect it to its framework's forms (Vue `v-model`, Angular `ControlValueAccessor`, form-associated custom elements):

- `value` (required): the prop holding the submitted value; it must be a `model` prop;
- `name`, `disabled`, `required`: the props holding the field's name and its disabled and required flags.

### Parts

`parts` names the pieces of a multi-part component, keyed by part name. A part has:

- `parent` (required): the component itself, or another part;
- `count` (required): how many instances one parent holds: `one`, `optional` or `many`;
- `portal: true` when the part renders outside the component's root, such as a dialog's content in an overlay layer; the verifier then captures it outside the story root;
- its own `props`, `events`, `slots`, `methods`, `states` and `a11y`, with the same rules as the component's.

The component's own fields describe the root, which holds the state the parts share. In version 0, a part with `count: many` can't be the parent of another `many` part (F-0006).

### Accessibility

`a11y`, on the component and on each part:

| Field | Content |
|---|---|
| `role` | The ARIA role of the element. |
| `name` | Where the accessible name comes from: `content` (the text content), `prop:<prop>` (a prop of the same component or part), `part:<Part>` (another part, as `aria-labelledby`) or `none`. |
| `describedBy` | Where the accessible description comes from, in the same form. |
| `aria` | ARIA attributes the element sets, each with when, such as `aria-busy: "true while loading"`. |
| `keyboard` | Key, with optional modifiers such as `Shift+Tab`, to its effect. |
| `focus` | `roving: <Part>` (arrow keys move focus between the part's instances), `trap: true`, `restore: true` (focus returns on close), `initial: <Part>` (receives focus on open). |

Contrast isn't a spec field: the accessibility check measures it.

### Fixtures

`fixtures` holds named content sets that stories render, keyed by kebab-case name. A fixture sets:

- `props`: prop values of the component;
- `slots`: slot content, keyed by slot name;
- `parts`: for each part, the list of its instances in order, each with its own `props` and `slots`;
- `extends`: another fixture this one starts from. Props and slots merge by name; a part's list replaces the base's list;
- `description`.

Slot content is one node or a list of nodes, rendered in order. A node is:

- text, written as a string or as `{ text: … }`;
- an icon: `{ icon: <name> }`, from the icon set the story matrix rules define;
- another component: `{ component: <Name>, props: …, slots: … }`, which must be listed in `uses`.

Fixtures carry the content that tests a layout: long labels, missing optional slots, many instances.

### Matrix

`matrix` holds the spec's hooks for the story matrix; the story matrix rules (T-0021) define what they mean and what happens when they're left out:

- `axes`: props whose values span the matrix, as `<prop>` or `<Part>.<prop>`; each is an enum or a boolean;
- `fixtures`: the fixtures stories render;
- `exclude`: invalid combinations, each a [condition](#conditions).

### Conditions

A condition (`when`) is `props` (prop values that must hold) and `state` (a state that must hold), or one of them. Token rules and exemptions use the props and states of their part, or of the component when they name no part.

### Tokens

`tokens` is an optional list of rules that say which role token a property must take, for the properties that give a variant or state its identity. Each rule has:

- `part`: the part it applies to; the component's root when left out;
- `when`: a [condition](#conditions); always when left out;
- `use`: CSS property to token, such as `background-color: color.action.primary`.

The token conformance check uses the rules for each story: for a property, the rule with the most specific matching condition sets the token the computed value must match. A property no rule covers must still match some role token, as for every component.

Specs name role tokens only, never raw tokens. The token names in the examples are placeholders until the token set is drafted (T-0033).

### Exemptions

`exemptions` waives a check where the spec says it doesn't apply. Each exemption has:

- `check` and `rule`: the IDs from the check catalogue (T-0022);
- `part`, `fixture` and `when`: where it applies; everywhere when all are left out;
- `reason` (required): why the check doesn't apply.

Every exemption is listed in the report and in the pull request summary. An exemption is the developer's decision, which the reviewer sees; the agent permission model (T-0024) keeps it out of the agent's reach.

### Extensions

`extensions` holds what a framework needs that the neutral API can't say, keyed by adapter ID: `vue`, `react`, `angular`, `svelte`, `web-components`. Before adding an extension, check whether the need is the same in every framework (then it belongs in the neutral API) or the same for every component of one framework (then it belongs in the adapter's defaults or the config file).

An adapter's block has up to five fields:

| Field | Content | Validated by |
|---|---|---|
| `reason` | Why the block exists. Optional; one reason covers the block. | |
| `options` | Component-level settings, such as an Angular selector or Web Components tag names. | the adapter |
| `map` | How an existing neutral member maps in this framework, keyed by its path. | the core checks the path; the adapter checks the value |
| `add` | Members that exist only in this framework, keyed by path, in the same long form as the neutral API. | the core |
| `omit` | Neutral members this framework doesn't offer, keyed by path, each with an optional `reason` and an optional `instead` (the path of the member that replaces it). | the core |

A path names a member: `<kind>.<name>`, or `parts.<Part>.<kind>.<name>`, where `<kind>` is `props`, `events`, `slots` or `methods`. Examples: `props.orientation`, `methods.focus`, `parts.Trigger.props.asChild`.

```yaml
extensions:
  vue:
    reason: Reka UI's composition pattern
    add:
      parts.Trigger.props.asChild:
        type: boolean
        default: false
        description: Render the slotted element as the trigger.
  angular:
    options:
      exportAs: fzTabs
    map:
      parts.Panel.slots.default:
        lazy: true
  web-components:
    omit:
      methods.focus:
        reason: HTMLElement.focus() already does this
```

A spec can carry blocks for adapters the consumer doesn't use, so the same spec can serve more than one framework. Stories come from the neutral API; an adapter may add stories for what its `add` entries introduce.

## Body

The body is prose for the agent and the judge, in second-level headings:

| Heading | Required | Content |
|---|---|---|
| `## Purpose` | yes | What the component is for and when to use it. |
| `## Behaviour` | yes | How it responds to input, as a list. Behaviour that spans parts goes here too. |
| `## Appearance` | no | What it should look like, in terms a viewer can judge; the judge's rubric is built from it (T-0026). |
| `## Content` | no | Guidance on labels and content. |
| `## Accessibility` | no | What the `a11y` fields can't say. |
| `## Never` | yes | Uses and looks that are wrong, as a list. |

Other second-level headings are allowed. Write anything measurable as a field rather than prose, so a check can test it.

## Approval

`fazon propose` drafts the API; the developer accepts or corrects it. The approved API is the spec's `props`, `events`, `slots`, `methods`, `forward`, `form`, `parts` (without their `states` and `a11y`) and `extensions`. Its hash is recorded in the component's provenance file (T-0028), not in the spec. `fazon generate` refuses to run while the spec's API no longer matches the approved hash, so a change to the API needs a new approval. The other fields change through review in the pull request.

## Validation

`fazon spec check` validates one spec or all of them, and CI runs it. A spec is valid when every rule below holds. SPEC-001 is the schema; the others need more than one file or a reference between fields, so the schema can't express them.

| Rule | What must hold |
|---|---|
| SPEC-001 | The front matter is valid against [the schema](schemas/spec.schema.json). |
| SPEC-002 | The file name is the kebab-case form of `name`, and no two specs share a name. |
| SPEC-003 | The body has the required headings: Purpose, Behaviour and Never. |
| SPEC-004 | An enum default is one of its values; an array default's items match `items`. |
| SPEC-005 | Every part's `parent` is the component or another part, with no cycles; no part has the component's name; no `many` part is the parent of another `many` part. |
| SPEC-006 | Within the component, and within each part, a name is used once across props, events and methods. |
| SPEC-007 | `forward` names `root` or a part; `form` names props of the component, and `form.value` is a `model` prop; every `prop:` and `part:` in `a11y` and every part in `focus` exists. |
| SPEC-008 | Every name in `uses` is an existing spec, and every component node in a fixture is listed in `uses`. |
| SPEC-009 | Fixtures: `extends` names another fixture, with no cycles; after merging, every prop, slot and part a fixture sets exists, and its value fits the type; every part has as many instances as its `count` allows; required props and slots are set; icons exist in the icon set. |
| SPEC-010 | Matrix: every axis is an enum or boolean prop; every fixture exists; every `exclude` condition is valid (SPEC-014). |
| SPEC-011 | Tokens: every token exists in the token set and is a role token; every `part` exists; every condition is valid (SPEC-014); no two rules with the same part and condition set the same property. |
| SPEC-012 | Exemptions: `check` and `rule` exist in the check catalogue; `part`, `fixture` and the condition exist (SPEC-014). |
| SPEC-013 | Extensions: every `map` and `omit` path exists in the neutral API, and no `add` path does; every `instead` names an existing or added member; a block for an adapter the consumer uses is valid against that adapter's schema. A block for another adapter is reported, not failed. |
| SPEC-014 | A condition names props of its part (or the component), with values of their type, and a state listed in that part's (or the component's) `states`. |

The command works without an agent, and the spec skill never writes a spec the check would reject.

## Examples

Under [examples/specs/](examples/specs/):

- `valid/`: [Button](examples/specs/valid/button.md) (a primitive), [Tabs](examples/specs/valid/tabs.md) (named parts, extensions for four adapters) and [Dialog](examples/specs/valid/dialog.md) (parts in a portal, a composed Button, an exemption). Each is valid under every rule, given a token set and an icon set that hold the names they use.
- `invalid/schema/`: each fails SPEC-001, at the path its `# expect-error-at:` comment names.
- `invalid/semantic/`: each passes the schema and fails the rule its `# fails:` comment names. They become test fixtures for `fazon spec check` in M2.

`just lint` checks the schema and the examples (`scripts/check-spec-examples.sh`): the valid and semantic examples must pass the schema, and every schema example must fail it at the named path.

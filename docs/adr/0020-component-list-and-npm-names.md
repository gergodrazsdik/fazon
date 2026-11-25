# 0020: Seventeen example components, with Menu and Popover; npm names `fazon` and `@fazon/*`

- Status: accepted
- Date: 2026-11-25
- Tracker: Q-0008, Q-0018
- Supersedes: the brief's [list of 15 components](../design/brief.md#the-15-components)

## Context and problem statement

The brief's example library has 15 components in three tiers:

- primitives: Button, Link, Badge, Avatar, Spinner;
- form controls: TextField, Textarea, Checkbox, RadioGroup, Switch, Select;
- composites: Card, Dialog, Tabs, Tooltip.

Q-0008 asks whether the list is right. Q-0018 asks which npm names the packages take beyond `fazon`, which the maintainer reserved (T-0082), before M1's first package.

## Considered options

1. **The components:** keep the 15; swap Avatar for a menu; swap Textarea for a popover; add components.
2. **npm names:** `fazon` for the CLI with `@fazon/core` and `@fazon/adapter-vue`; unscoped `fazon-core` and `fazon-adapter-vue`; only `fazon`, with the core and the Vue adapter bundled in it.

## Decision outcome

The maintainer chose:

1. **Keep the 15 and add Menu and Popover,** both composites built on Reka UI (Menu on its `DropdownMenu`). The library has 17 components. Menu adds keyboard navigation over a list of items in a portal; Popover adds a non-modal portal with focus handling, between Tooltip and Dialog.
2. **`fazon` and `@fazon/*`.** `fazon` is the CLI, the package an adopter installs. The core is `@fazon/core`, and the Vue adapter `@fazon/adapter-vue`, which `adapter: vue` in `fazon.yaml` loads. Later adapters are `@fazon/adapter-<name>`, all under one scope.

| Tier | Components |
|---|---|
| Primitives | Button, Link, Badge, Avatar, Spinner |
| Form controls | TextField, Textarea, Checkbox, RadioGroup, Switch, Select |
| Composites | Card, Dialog, Menu, Popover, Tabs, Tooltip |

### Consequences

- M4 builds the remaining 13 components, and "15 components pass" becomes 17 (T-0060). The second measurement and calibration rounds cover all 17.
- The milestones' other component counts follow: M1's Button and M2's Badge, Link and Dialog are unchanged.
- The maintainer creates the free `fazon` npm organisation and reserves `@fazon/core` and `@fazon/adapter-vue` with placeholder packages before M1's first package (T-0087), as `fazon` was reserved.
- The adapter boundary lists the packages, and its example pins both `fazon` and `@fazon/adapter-vue` to the framework commit.
- The brief still says 15; this ADR supersedes its list until the maintainer updates the brief.

## More information

- Brief: [The 15 components](../design/brief.md#the-15-components), [Milestones](../design/brief.md#milestones)
- Adapter boundary: [Packages](../spec/adapter-boundary.md#packages)

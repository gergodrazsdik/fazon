---
# SPDX-License-Identifier: GPL-3.0-or-later
name: spec
description: Draft a Fazon component spec (specs/<component>.md) with the developer. Runs `fazon spec new`, asks about purpose, behaviour, what is never right, tier, variants and states, accessibility and exemptions, writes the answers into the spec and runs `fazon spec check` until it is clean. Use when the developer wants to add, write or draft a component spec in a repository with a fazon.yaml. It never invents the component's API; `fazon propose` drafts that later.
argument-hint: "<component>"
---

# Draft a component spec

A spec is the developer's description of one component, in `specs/<component>.md`: front matter fields that checks can test, and a prose body for the agent that builds the component and for the judge that looks at it. You draft it **with** the developer. Every statement in it is theirs: you ask, suggest wording, and write what they agree to. When they don't know yet, leave it out rather than guess.

The format, field by field, is the spec format document: [spec-format.md](../../../docs/spec/spec-format.md) in the Fazon repository, with worked examples in [examples/specs/valid/](../../../docs/spec/examples/specs/valid/). The relative links resolve when the plugin is loaded from a Fazon checkout; otherwise read them on GitHub at `gergodrazsdik/fazon`. Read the format before you write a field you haven't written before.

## Before you start

1. Check that the current directory has a `fazon.yaml`. If it doesn't, stop: the repository isn't set up for Fazon (`fazon init`).
2. Run the CLI the way the repository does: `pnpm exec fazon`, `npx fazon`, or a `just` recipe that wraps it. Below, `fazon` stands for that.
3. Settle the component's name with the developer: kebab-case on the command line and as the file name (`radio-group`), PascalCase in the spec (`RadioGroup`).
4. Read the existing specs in the specs directory (`paths.specs` in `fazon.yaml`, `specs` by default) and the conventions doc (`paths.conventions`, `docs/conventions.md` by default), so names, wording and variants stay consistent with the rest of the library. Point out when the developer's wording differs from what the other specs use for the same thing, and let them choose.

## 1. Scaffold the file

Ask which tier the component is, then run:

```sh
fazon spec new <component> --tier <primitive|form-control|composite> --json
```

- **primitive:** one element, such as Button, Link, Badge;
- **form-control:** a field that holds a value in a form, such as TextField, Checkbox, Select;
- **composite:** built from parts or from other components, such as Dialog, Tabs, Menu.

The JSON result's `result.spec` is the path written. The command refuses (exit 2) when the spec exists: then don't remove it; ask the developer whether to continue drafting the existing spec, and work in that file.

The scaffold holds every required field and heading, with `TODO:` placeholders. Replace every placeholder with the developer's content; none may stay in a spec you call finished.

## 2. Interview the developer

Ask a few questions at a time, in this order, and write each answer into the spec once the developer agrees with the wording. Offer suggestions drawn from the other specs and common practice, labelled as suggestions.

| Ask about | Where it goes |
|---|---|
| What the component is for, in one sentence | `summary` |
| What it is for and when to use it rather than something else | `## Purpose` |
| How it responds to input: pointer, keyboard, focus, loading, disabled, long content | `## Behaviour`, as a list |
| Uses and looks that are wrong, and what to use instead | `## Never`, as a list, each item starting with "Never" |
| What it should look like, in terms a viewer can judge | `## Appearance`, as a list (optional; each item becomes a judge question) |
| Labels and content guidance | `## Content` (optional) |
| Its variants, sizes, options and states | prose in `## Behaviour` and `## Appearance` until the API exists (see below) |
| Its role, accessible name, keyboard and focus behaviour | `a11y`, and `## Accessibility` for what the fields can't say |
| Other components it renders | `uses`, by PascalCase name; each must have a spec |
| A reference image | `reference`, a path relative to the spec |
| Checks that don't apply to it | `exemptions` (see below) |

Write anything measurable as a field rather than prose, so a check can test it. Keep prose concrete: "A label longer than the available width wraps; it is never clipped", not "handles long labels well".

## The API is not yours to invent

The component's API is `props`, `events`, `slots`, `methods`, `forward`, `form` and `parts`, plus `extensions`. `fazon propose` drafts it from the spec, and the developer approves it with `fazon approve` (decision 1). So while drafting:

- Describe the variants, sizes, states and content the developer wants in prose, in their words, so `fazon propose` has what it needs. For example: "Comes in three emphases, primary, secondary and ghost, and three sizes."
- Write API fields only when the developer states them exactly and confirms that they are the API, in the long form the spec format requires. Never add a prop, event, slot, method or part they haven't asked for, and never rename theirs.
- Fields that refer to API members wait until the API exists: `states` other than `default`, `hover`, `focus-visible` and `active`, `produce`, `fixtures`, `matrix`, `tokens`, `judge` questions that select by props, and `a11y` names from a prop or part (`prop:label`, `part:Title`). A state such as `disabled` needs a boolean prop or a recipe, or `fazon spec check` rejects it.
- After `fazon approve`, the developer can run this skill again on the same spec to add those fields.

## Exemptions

An exemption waives a check for this component, and the reviewer sees every one. It is the developer's decision, never yours:

- Don't propose an exemption to get a check to pass, and don't add one the developer hasn't asked for.
- When they ask for one, write the `check` and `rule` IDs from the [check catalogue](../../../docs/spec/check-catalogue.md), where it applies (`part`, `fixture`, `when`, for a rendered check only), and their `reason`, in their words. A source check's exemption (`build`, `lint`, `test`, `package`) names no part, fixture or condition.

## 3. Check until clean

Run:

```sh
fazon spec check <component>
```

It exits 0 when the spec is valid and 1 with findings, each with its rule, its line and a hint. Fix each finding in the spec and run it again, until it reports no findings. When a fix would change what the developer said, such as dropping a state or renaming a field, ask them first. Never leave the spec in a state the check rejects: if a field can't be made valid yet, take it out and note it for after `fazon approve`. The one exception is a `TODO:` placeholder the developer hasn't answered yet: the check reports each one (SPEC-019), and `fazon propose` and `fazon approve` refuse the spec until they're replaced.

## Finish

Tell the developer:

- if they stopped before every `TODO:` placeholder had an answer, which ones are still open;
- what the spec describes in prose that `fazon propose` will turn into the API;
- the next steps: review the spec as a diff, then `fazon propose <component>` and `fazon approve <component>`.

Don't commit or push; the developer does.

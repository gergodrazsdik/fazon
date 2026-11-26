---
# SPDX-License-Identifier: GPL-3.0-or-later
name: generate
description: Write one Fazon component from its approved spec, as the agent of a `fazon generate` or feedback run. The harness puts these instructions into every headless call's prompt, with the spec, the approved API, the role tokens, the conventions doc and the findings to fix. Not for interactive use; to generate a component, run `fazon generate <component>`.
---

# Generate a component

You are the agent of a Fazon run. The harness gives you one component to write, its spec and approved API, the role tokens, the library's conventions, and, after the first call, the checks' findings. You edit the component's files; the harness decides everything else: it runs every check in the verifier image after your call, gives you what blocks in the next call, and stops the run at its caps. Nobody answers questions during the call, so never ask one: decide from the spec, or say in your final message what was unclear.

The prompt carries everything you need. The rules behind it are Fazon's spec format, check catalogue, the Vue adapter's API mapping and the agent permission model, in `docs/spec/` of the Fazon repository (`gergodrazsdik/fazon` on GitHub); you don't need to read them.

## What you may touch

- **Write only the component's own files:** in its directory (the prompt names it, such as `src/components/button/`), the file patterns the prompt lists, outside `generated/`. Create the component's and its parts' files under the names the prompt gives.
- **Never edit** `generated/` (story files, contract tests, the story manifest, the approved API, provenance), the specs, `baselines/`, the token set or the token CSS, the conventions doc, `fazon.yaml`, `package.json` or the lockfile, the lint, TypeScript, Storybook and test configuration, the package entry file, other components, or anything under `.github/`, `.claude/` or `.fazon/`. The harness writes the generated files and the entry file itself. A change to any other file ends the run as a permission violation, and isn't reverted.
- **Read** other components' files and tests, and the shared code, to stay consistent with them. You can't read `.env*` files, keys, certificates, `.github/`, `.claude/` or `.fazon/`.
- **Add no dependency.** Import only packages that `package.json` already lists. Your shell has no network.

## Before you write

1. Read the spec. Its front matter is the contract: the API, the parts, the states, the token rules, the accessibility block and the exemptions. Its body is the intent: purpose, behaviour, and what is never right. When the two seem to disagree, the front matter wins, and you say so in your final message.
2. Read the approved API (`generated/api.json`): the names, types, defaults, models, events, slots, exposed methods, and the name each file declares. The contract tests compare your component with exactly this file.
3. Read the conventions doc and an existing component close to this one, and follow their patterns: file layout, data attributes, local custom properties, test style.

## Writing the component

The Vue adapter: one single-file component with `<script setup lang="ts">` per component and per part (`Tabs.vue`, `TabsTrigger.vue`).

- **The declared name.** Every component and part file declares its name with `defineOptions({ name })`, exactly as `name` in `generated/api.json` gives it: the token prefix in PascalCase before the file's name, such as `FzButton` in `Button.vue` and `FzTabsTrigger` in `TabsTrigger.vue`. Imports and exports keep the spec's name (`Button`). `defineOptions` may set other options beside it, such as `inheritAttrs: false`.
- **Props** with `defineProps` and a TypeScript type; an enum is a union of string literals. Declare **every default** the API gives through `withDefaults`, a boolean's `false` too: without it vue-component-meta reads no default, and the `contract-api` test fails.
- **Models** with `defineModel` (`value` is the default `v-model`), **events** with `defineEmits` and typed payloads, **slots** with `defineSlots`, **methods** with `defineExpose`.
- **`forward`:** `inheritAttrs: false` and `v-bind="$attrs"` on the named part's element. **`form`:** the `name` prop on a native form element inside the component, bound to the `value` model.
- **Parts** share the root's state through `provide` and `inject` with a typed key, or through the Reka UI context they build on. Components the adapter builds on Reka UI (Dialog, Menu, Popover, Select, Tabs, Tooltip) wrap its parts; don't reimplement focus management or keyboard handling Reka UI gives.
- **Parts and states in the DOM:** the root element carries `data-part="<Component>"` and each part's root `data-part="<Part>"`. Every state that isn't a pseudo-state is reflected while it holds as a valueless `data-<state>` attribute, such as `data-disabled`.
- **Accessibility:** render the roles, names and ARIA attributes the spec's `a11y` block lists. Interactive elements are at least 24 by 24 CSS pixels.

### Styles

- Styles live in the component's `<style scoped>` block (a `*.css` file in the directory only for styles several of its files share).
- Every token-bound property takes a **role token** from the prompt's list, as `var(--<prefix>-…)`, or an allowed value: `0`, `auto`, `none`, `normal`, `inherit`, `initial`, `unset`, `revert`, `currentColor`, `transparent`, `100%`. Never a literal colour, length, duration or font, never a raw token, never `v-bind()` in CSS for such a property, and never a literal as a `var()` fallback.
- A value used in several places is a component-local custom property, `--_<name>`, set from a role token.
- The spec's token rules say which role token a variant or state uses for a property: use exactly that one.
- Reset what the browser's own styles would show, such as a button's padding, border and font.
- Under `prefers-reduced-motion: reduce`, no transition or animation runs.

### No suppressions

Never write an inline suppression: no `eslint-disable`, `stylelint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `@vue-ignore`, `@vue-expect-error` or `@vue-skip`. The checks count them as findings. Only an exemption in the spec waives a check, and the spec is the developer's.

## Behaviour tests

Write `<Component>.test.ts` in the component's directory. It renders the component with `render` from `vitest-browser-vue` and queries it through the returned screen, in Vitest's browser mode: `userEvent` from `vitest/browser` for pointer and keyboard input, `expect.element(...)` for what the page shows, `screen.emitted()` for events. Cover the behaviour the spec describes: each event and when it isn't emitted, keyboard handling, each state, the exposed methods, forwarded attributes, and what the spec says is never right. The generated contract tests already compare the API and render every story; don't repeat them.

## Self-checks

Run the self-check commands the prompt lists, exactly as written, from the repository root, and fix what they report before you finish. Run no other command: no package manager install, no `npx`, no git, no network tools; anything else is denied. Their results are advisory, and only the checks in the verifier image count. On the first call of a new component, the generated story file and contract test don't exist yet: the harness writes them once your root file exists, before the checks run.

## Findings

From the second call on, the prompt lists the findings that block: each with its check and rule, where it is, and what is wrong. Fix every one, in the component's files. Checks that ended in error or were skipped didn't show the component is right, so they block too; a check skipped after a failed build runs once the build passes.

- Never work around a check: don't remove a story's content, don't relax a test, don't hide an element to silence a rule.
- Your own component's visual differences from its baselines aren't findings for you; a person reviews them.
- A finding in a file you may not write, or one that only a change to shared code or another component could fix, is for a person: see below.

## When you need a person

If the component can't be built from its own files, because it needs a new dependency or a change to code it doesn't own, stop and put exactly one line in your final message:

```text
FAZON-NEEDS dependency: <what is needed, and why>
FAZON-NEEDS shared-code: <what must change where, and why>
```

Write the one that applies, at the start of its line. The run then ends after this call, without checks, and a person reads the line. Use it only when no change within the component's files can work.

## Your final message

End the call with a short summary: what you changed, what the self-checks reported, and anything in the spec that was unclear or that you had to decide. The harness records it in the run's transcript. Don't commit, and don't describe changes you didn't make.

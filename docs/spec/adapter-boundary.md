# Adapter boundary

What the framework-neutral core does, what a framework adapter supplies, what the Vue adapter does in version 1, and how the example repository consumes the framework before the packages are published. Decisions behind it: [ADR 0016](../adr/0016-adapter-boundary.md).

- Version: **0**; it may change in any pull request until Fazon 1.0. The adapter contract is internal, and may change freely until a second adapter exists ([brief](../design/brief.md#framework-adapters)).
- Tracker: T-0031, Q-0001.

## Scope

| What | Defined in |
|---|---|
| The neutral API and the `extensions` shape | [Spec format](spec-format.md#the-neutral-api) |
| The story manifest the adapter turns into story files | [Story matrix rules](story-matrix.md#the-manifest) |
| The checks whose commands the adapter supplies | [Check catalogue](check-catalogue.md) |
| The component directory, self-checks and generated files | [Agent permission model](agent-permissions.md) |
| What `fazon init` writes | [CLI reference](cli.md#fazon-init) |
| The reusable workflow the example repository calls | [Reusable workflow interface](workflow.md) |
| The token set's format and build; the example library's token set and conventions doc | [Token set](tokens.md), [example library drafts](example-library/README.md) |

## Core and adapter

The core never imports framework code. It owns:

- the tokens pipeline;
- the spec format and `spec check`;
- the story matrix and manifest;
- the loop, caps and run records;
- the verifier and every rendered check;
- the judge, the report and the CI workflow.

An adapter supplies everything that depends on the framework:

| Capability | Input → output | Used by |
|---|---|---|
| **API mapping** | the neutral API, with its extensions → the framework's API: names, types, bindings | the agent's prompt, contract tests, `spec check` (SPEC-013) |
| **Extension schema** | → JSON Schema fragments for its `extensions` block's `options` and `map` values | `spec check` |
| **Component files** | a component and its parts → file names, and the file patterns allowed in its directory | the harness, PERM-003 |
| **Story files** | the story manifest → story files in `generated/` | `fazon sync`, the Storybook build |
| **Contract tests** | the approved API and the manifest → test files in `generated/` | the `test` check |
| **API reader** | the component's files → its actual API, in the mapping's form | the contract tests (`contract-api`) |
| **Entry exports** | the components and their parts → the package entry file's exports | `fazon sync` |
| **Source-check commands** | → the commands for `build`, `lint`, `test` and `package`, run in the verifier | the source checks |
| **Self-check commands** | a component → the type-check, lint and test commands the agent may run on the host, and the cache directories they write to | the agent's permissions |
| **Storybook setup** | → the framework's Storybook configuration, with the theme switch that sets `data-theme`, and the icon set's license notice in the static build (the story files render the story frame) ([license terms](licensing.md#lucide)); the token set's themes and default theme → a generated module the configuration imports them from | `fazon init`, `fazon sync`, the Storybook build |
| **Scaffold** | → the library build, type declarations, exports map, lint and test configuration | `fazon init` |
| **Conventions template** | → a conventions doc to start from | `fazon init` |
| **Generation skill** | → the skill with the framework's idioms, in the Claude Code plugin | the agent |
| **Headless guidance** | → which headless primitives each kind of component builds on | the generation skill |

The core calls these through an internal TypeScript interface in `packages/core`; the adapter package implements it. M1 writes the interface.

## Packages

| Package | Directory | What it is |
|---|---|---|
| `fazon` | `packages/cli` | The CLI, with the `fazon` command; what an adopter installs |
| `@fazon/core` | `packages/core` | The core; the CLI and every adapter depend on it |
| `@fazon/adapter-vue` | `packages/adapter-vue` | The Vue adapter, loaded when `fazon.yaml` says `adapter: vue` |

A later adapter is `@fazon/adapter-<name>`. The `fazon` npm organisation holds the scope ([ADR 0020](../adr/0020-component-list-and-npm-names.md)).

## The Vue adapter

Version 1 ships one adapter, `vue`: Vue 3 single-file components with `<script setup lang="ts">`, plain CSS with custom properties, scoped per component, and Reka UI for components with complex behaviour.

### Component files

In `<components>/<name>/`:

| File | Written by |
|---|---|
| `<Component>.vue`, and `<Component><Part>.vue` for each part (`Tabs.vue`, `TabsTrigger.vue`) | the agent |
| `*.ts` helpers, `*.css` | the agent |
| `*.test.ts`: the behaviour tests, which render the component with `vitest-browser-vue` | the agent |
| `generated/<Component>.stories.ts`, `generated/<name>.contract.test.ts`, `generated/api.json`, `generated/stories.json`, `generated/provenance.json` | the harness |

The agent may write files matching `*.vue`, `*.ts` and `*.css` outside `generated/`.

### API mapping

| Neutral | Vue |
|---|---|
| component | `defineOptions({ name })`: the token prefix in PascalCase before the component's name, such as `FzButton`, so the name never collides with an HTML element; consumers import `Button` ([component names](#component-names), [ADR 0022](../adr/0022-build-from-source-and-component-names.md)) |
| prop | `defineProps` with a TypeScript type; an enum is a union of string literals; defaults through `withDefaults` |
| `model: true` | `defineModel`: the model named `value` is the default `v-model` (`modelValue`), any other is `v-model:<name>` |
| event | `defineEmits` with a typed payload |
| slot | `defineSlots`; slot `data` becomes the scoped slot's props |
| method | `defineExpose` |
| part | its own single-file component; the parts share the root's state through `provide`/`inject` with a typed key, or the Reka UI context they build on |
| `forward` | `defineOptions({ inheritAttrs: false })` and `v-bind="$attrs"` on the named part's element |
| `form` | the `name` prop on a native form element inside the component, bound to the `value` model |

`generated/api.json` holds the approved API after this mapping, for the contract tests to compare with.

#### Component names

Each single-file component, the component's and each part's, declares its name with `defineOptions({ name })` ([ADR 0022](../adr/0022-build-from-source-and-component-names.md)):

- **The name:** `tokens.prefix` from `fazon.yaml` in PascalCase (each hyphen-separated word capitalised: `fz` is `Fz`, `my-ui` is `MyUi`), then the file's base name. With the prefix `fz`, `Button.vue` declares `FzButton` and `TabsTrigger.vue` declares `FzTabsTrigger`. `defineOptions` may set other options beside it, such as `inheritAttrs: false`.
- **Imports keep the spec's names:** the file, the entry file's export and the story file use `Button` and `TabsTrigger`; only the declared name carries the prefix.
- **Without a prefix,** the name is the file's base name. A part's name always has two words, and so does a component's whose name has two, such as `IconButton`. A one-word component, such as `Button`, would declare a one-word name, which ESLint's `vue/multi-word-component-names` fails and an HTML element could clash with, so `fazon sync` refuses its spec and says to set `tokens.prefix`.
- **Checked by `contract-api`:** api.json records each declared name as `name`, and the contract test fails a file that declares no name or another one, such as "Button: the component's name is "Button"; the approved API says "FzButton"."

The Vue adapter's `extensions` block takes:

- `add` and `omit` as the core defines them;
- `map` values of the form `{ name: <camelCase> }`, to rename a member;
- no `options` in version 0.

### Headless primitives

Dialog, Menu, Popover, Select, Tabs and Tooltip are built on Reka UI. Each part maps to the Reka UI part it wraps (`TabsTrigger` wraps `TabsTrigger`; Menu wraps Reka UI's `DropdownMenu`), so the agent writes styling and composition and doesn't reimplement focus management. Reka UI's `asChild` is offered only through an extension ([example](examples/specs/valid/tabs.md)).

### Stories

`generated/<Component>.stories.ts` is a CSF 3 file for Storybook 10 with the Vue and Vite framework:

- **Title:** the component's name.
- **One export per manifest story:** its name in PascalCase, without the component.
- **Rendering:** each story renders the fixture with the story's `set` values. A decorator renders the story frame (with `frame.width`).
- **Themes:** the theme is a Storybook global the verifier sets. Its values are the token set's themes, the default first, which `fazon sync` writes to `.storybook/generated/themes.ts` as `themes` and `defaultTheme`; `.storybook/preview.ts` imports them.

### Fixtures in stories

How a story file renders a fixture:

- **Parts** render in their parent's default slot, before the slot's own content. So a component or part with child parts has a `default` slot in `api.json`, required when one child part has `count: one`.
- **Instances under a `many` parent:** when the parent has one instance, every instance of the child part goes to it; otherwise each parent instance gets one, in order, and `fazon sync` refuses any other count.
- **Icons** render as their SVG inside `span[data-fazon-icon]`, with `display: contents`.
- **Models:** a model prop the fixture sets is bound to a `ref` the story owns; the others stay uncontrolled.

### Contract tests

`generated/<name>.contract.test.ts` runs in Vitest's browser mode:

- **`contract-api`:** vue-component-meta reads the component's props, with their types and defaults, events, slots, exposed members and models from its TypeScript, and the reader takes the name `defineOptions` declares from the same code. The test compares them with `generated/api.json`.
- **`contract-render`:** every story renders through Storybook's portable stories (`composeStories`), with any console error or warning failing the test.

### Commands

| Purpose | Command (in the consumer's repository) | Where |
|---|---|---|
| `build` / `compile` | `vite build`, in library mode | verifier |
| `build` / `types` | `vue-tsc --noEmit` | verifier |
| `build` / `storybook` | `storybook build` | verifier |
| `lint` | `eslint` and `stylelint` on the component's files, with Fazon's rules | verifier |
| `test` | `vitest run`, in browser mode, on the component's tests and contract tests | verifier |
| `package` | `pnpm pack`, then publint and Are the Types Wrong on the tarball, with its `esm-only` profile and bundler resolution, which reads the `.vue` files' declarations | verifier |
| self-check: types | `pnpm exec vue-tsc --noEmit` | host, in the agent's sandbox |
| self-check: lint | `pnpm exec eslint <dir>`; `pnpm exec stylelint "<dir>/**/*.{vue,css}"` | host |
| self-check: tests | `pnpm exec vitest run <dir>` | host |

### What `fazon init` writes for Vue

Files that don't exist yet:

- the Vite library configuration;
- the TypeScript configuration in strict mode;
- the ESLint and Stylelint configuration with Fazon's rules;
- the Vitest configuration with browser mode;
- the Storybook configuration;
- the package entry file;
- the conventions template, which states the [component names](#component-names) rule and that behaviour tests render components with `vitest-browser-vue`'s `render`.

The consumer's `package.json` gets the scripts and dev dependencies, pinned. M1 pins their versions:

- `vue`, `reka-ui`;
- `storybook`, `@storybook/vue3-vite`;
- `vitest`, `@vitest/browser-playwright`, `playwright`, and `vitest-browser-vue` for the behaviour tests;
- `vite`, `@vitejs/plugin-vue`;
- `vue-tsc`, `vue-component-meta`;
- `eslint`, `eslint-plugin-vue`, `stylelint`;
- the Style Dictionary package the tokens pipeline uses.

## Consuming the framework before M5

Until M5, the example repository pins **one framework commit**, and three references move together:

| What | How it's referenced |
|---|---|
| The CLI and the Vue adapter | the commit built from source: a script fetches it into a gitignored `.fazon-framework/<sha>/` directory, installs it from its lockfile and builds it, and the packages are `file:` dependencies on that directory ([ADR 0022](../adr/0022-build-from-source-and-component-names.md)) |
| The reusable workflow | `uses: gergodrazsdik/fazon/.github/workflows/<workflow>.yml@<sha>` |
| The verifier image | `image` in `fazon.yaml`: the digest of the image the framework's CI built from that commit |

For example, with `@fazon/core` and `@fazon/adapter-vue` also overridden to the same directory in `pnpm-workspace.yaml`, so the packages' dependencies on each other resolve there:

```json
{
  "devDependencies": {
    "fazon": "file:.fazon-framework/<sha>/packages/cli",
    "@fazon/adapter-vue": "file:.fazon-framework/<sha>/packages/adapter-vue"
  }
}
```

pnpm git dependencies don't work for this: a package path can't resolve the packages' `workspace:*` dependencies, and nothing builds `dist/`, which isn't in git.

**Pre-release images:** on every push to `main`, the framework's CI builds the verifier image and pushes it to GHCR, tagged `sha-<sha>`. The example repository pins it by digest. This needs `packages: write` in that one job of the framework's CI from M1, earlier than the brief planned ([ADR 0016](../adr/0016-adapter-boundary.md)). Signing and provenance attestations still arrive with the releases in M5 (T-0066).

**Moving the pin** is one pull request in the example repository. It changes the dependencies' SHA, the workflow reference and the image digest together, and `fazon upgrade` writes the digest. A check in the example repository's CI fails when the three don't name the same commit.

**From M5,** the three become a released package version, a versioned workflow tag and the released image's digest.

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| ADAPTER-001 | No core package imports a framework package or an adapter. | a lint rule in the framework repository, from M1 |
| ADAPTER-002 | An adapter writes only into a component's `generated/` directory, the entry file, and, during `init`, files that don't exist yet. | the harness |
| ADAPTER-003 | Before M5, the commit in the example repository's `.fazon-framework/<sha>/` dependencies, its workflow reference and its image tag are the same framework commit. | the example repository's CI |
| ADAPTER-004 | The contract tests compare the component's API, as vue-component-meta reads it, with `generated/api.json`. | the `test` check |

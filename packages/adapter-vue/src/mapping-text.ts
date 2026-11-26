// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue API mapping as the agent's prompt shows it (docs/spec/adapter-boundary.md#api-mapping).

/** How the neutral API becomes a Vue 3 component's API, and the Vue `extensions` block. */
export const apiMappingText = `| Neutral | Vue 3 (\`<script setup lang="ts">\`) |
|---|---|
| component | a single-file component that declares its name with \`defineOptions({ name })\`: the token prefix in PascalCase before the component's name, such as \`FzButton\`; consumers import \`Button\` |
| prop | \`defineProps\` with a TypeScript type; an enum is a union of string literals; defaults through \`withDefaults\` |
| \`model: true\` | \`defineModel\`: the model named \`value\` is the default \`v-model\` (\`modelValue\`), any other is \`v-model:<name>\` |
| event | \`defineEmits\` with a typed payload |
| slot | \`defineSlots\`; slot \`data\` becomes the scoped slot's props |
| method | \`defineExpose\` |
| part | its own single-file component, named \`<Component><Part>\`, such as \`TabsTrigger\`; the parts share the root's state through \`provide\`/\`inject\`, or the Reka UI context they build on |
| \`forward\` | \`defineOptions({ inheritAttrs: false })\` and \`v-bind="$attrs"\` on the named part's element |
| \`form\` | the \`name\` prop on a native form element inside the component, bound to the \`value\` model |

Dialog, Menu, Popover, Select, Tabs and Tooltip build on Reka UI: each part wraps the Reka UI part of its name. Reka UI's \`asChild\` is offered only through an extension.

The \`vue\` block of \`extensions\` takes \`add\` and \`omit\` (as the neutral format defines them) and \`map\` values of the form \`{ name: <camelCase> }\` to rename a member; no \`options\`.`;

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- The end-to-end test's Button: docs/spec/examples/specs/valid/button.md, styled with role tokens only. -->
<script setup lang="ts">
import { ref } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost";
    size?: "sm" | "md" | "lg";
    disabled?: boolean;
    loading?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "primary", size: "md", disabled: false, loading: false, type: "button" },
);
const emit = defineEmits<{ click: [] }>();
defineSlots<{ default(): unknown; icon?(): unknown }>();
const element = ref<HTMLButtonElement>();
defineOptions({ name: "FzButton" });
defineExpose({ focus: () => element.value?.focus() });

function activate() {
  if (props.disabled || props.loading) return;
  emit("click");
}
</script>

<template>
  <button
    ref="element"
    class="button"
    data-part="Button"
    :type="props.type"
    :data-variant="props.variant"
    :data-size="props.size"
    :data-disabled="props.disabled ? '' : undefined"
    :data-loading="props.loading ? '' : undefined"
    :disabled="props.disabled"
    :aria-busy="props.loading ? 'true' : undefined"
    :aria-disabled="props.loading ? 'true' : undefined"
    @click="activate"
  >
    <span v-if="props.loading" class="spinner" aria-hidden="true"></span>
    <slot v-else name="icon" />
    <slot />
  </button>
</template>

<style scoped>
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--fz-space-gap-sm);
  margin: 0;
  min-block-size: var(--fz-size-control-md);
  padding-block: var(--fz-space-inset-xs);
  padding-inline: var(--fz-space-inset-md);
  border-style: solid;
  border-width: var(--fz-border-width-default);
  border-color: transparent;
  border-radius: var(--fz-radius-control);
  background-color: var(--fz-color-action-primary);
  color: var(--fz-color-text-on-action);
  font-family: var(--fz-font-family-body);
  font-size: var(--fz-font-size-body);
  font-weight: var(--fz-font-weight-medium);
  line-height: var(--fz-line-height-tight);
  letter-spacing: normal;
  text-align: center;
  cursor: pointer;
}

.button[data-size="sm"] {
  min-block-size: var(--fz-size-control-sm);
  padding-inline: var(--fz-space-inset-sm);
  font-size: var(--fz-font-size-small);
}

.button[data-size="lg"] {
  min-block-size: var(--fz-size-control-lg);
  padding-inline: var(--fz-space-inset-lg);
  font-size: var(--fz-font-size-large);
}

.button[data-variant="primary"]:hover {
  background-color: var(--fz-color-action-primary-hover);
}

.button[data-variant="primary"]:active {
  background-color: var(--fz-color-action-primary-active);
}

.button[data-variant="secondary"] {
  border-color: var(--fz-color-border-default);
  background-color: var(--fz-color-surface-raised);
  color: var(--fz-color-text-primary);
}

.button[data-variant="ghost"] {
  background-color: transparent;
  color: var(--fz-color-text-action);
}

.button[data-variant="secondary"]:hover,
.button[data-variant="ghost"]:hover {
  background-color: var(--fz-color-surface-hover);
}

.button[data-variant="secondary"]:active,
.button[data-variant="ghost"]:active {
  background-color: var(--fz-color-surface-active);
}

.button:focus-visible {
  outline-style: solid;
  outline-width: var(--fz-border-width-focus);
  outline-color: var(--fz-color-focus-ring);
  outline-offset: var(--fz-outline-offset-focus);
}

.button[data-disabled] {
  border-color: var(--fz-color-border-default);
  background-color: var(--fz-color-surface-subtle);
  color: var(--fz-color-text-disabled);
  cursor: not-allowed;
}

/* Loading keeps the variant's colours and blocks activation. */
.button[data-loading] {
  cursor: progress;
}

.spinner {
  display: inline-block;
  inline-size: var(--fz-size-icon-sm);
  block-size: var(--fz-size-icon-sm);
  border-style: solid;
  border-width: var(--fz-border-width-focus);
  border-color: currentColor;
  border-radius: var(--fz-radius-full);
}
</style>

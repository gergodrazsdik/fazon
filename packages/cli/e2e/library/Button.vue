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
  gap: var(--space-gap-sm);
  margin: 0;
  min-block-size: var(--size-control-md);
  padding-block: var(--space-inset-xs);
  padding-inline: var(--space-inset-md);
  border-style: solid;
  border-width: var(--border-width-default);
  border-color: transparent;
  border-radius: var(--radius-control);
  background-color: var(--color-action-primary);
  color: var(--color-text-on-action);
  font-family: var(--font-family-body);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-tight);
  letter-spacing: normal;
  text-align: center;
  cursor: pointer;
}

.button[data-size="sm"] {
  min-block-size: var(--size-control-sm);
  padding-inline: var(--space-inset-sm);
  font-size: var(--font-size-small);
}

.button[data-size="lg"] {
  min-block-size: var(--size-control-lg);
  padding-inline: var(--space-inset-lg);
  font-size: var(--font-size-large);
}

.button[data-variant="primary"]:hover {
  background-color: var(--color-action-primary-hover);
}

.button[data-variant="secondary"] {
  border-color: var(--color-border-default);
  background-color: var(--color-surface-raised);
  color: var(--color-text-primary);
}

.button[data-variant="ghost"] {
  background-color: transparent;
  color: var(--color-text-action);
}

.button[data-variant="ghost"]:hover {
  background-color: var(--color-surface-hover);
}

.button:focus-visible {
  outline-style: solid;
  outline-width: var(--border-width-focus);
  outline-color: var(--color-focus-ring);
  outline-offset: var(--outline-offset-focus);
}

/* The spec's token rules hold in every state, so disabled and loading only fade the button. */
.button[data-disabled],
.button[data-loading] {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner {
  display: inline-block;
  inline-size: var(--size-icon-sm);
  block-size: var(--size-icon-sm);
  border-style: solid;
  border-width: var(--border-width-focus);
  border-color: currentColor;
  border-radius: var(--radius-full);
}
</style>

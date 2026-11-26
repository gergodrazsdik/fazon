<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- fazon-fixture: check=lint expect=pass -->
<script setup lang="ts">
withDefaults(defineProps<{ variant?: "primary" | "secondary" }>(), { variant: "primary" });
</script>

<template>
  <button class="lint-button" type="button" data-part="LintButton" :data-variant="variant">
    <slot />
  </button>
</template>

<style scoped>
.lint-button {
  --_padding-inline: var(--fz-space-inset-md);
  margin: 0;
  padding: var(--fz-space-inset-sm) var(--_padding-inline);
  border: var(--fz-border-width-default) solid transparent;
  border-radius: var(--fz-radius-control);
  background-color: var(--fz-color-action-primary);
  color: var(--fz-color-text-on-action);
  font: inherit;
  font-weight: var(--fz-font-weight-medium);
  transition: background-color var(--fz-motion-duration-fast) var(--fz-motion-easing-standard);
}

.lint-button:hover {
  background-color: var(--fz-color-action-primary-hover);
}

.lint-button:focus-visible {
  outline: var(--fz-border-width-focus) solid var(--fz-color-focus-ring);
  outline-offset: var(--fz-outline-offset-focus);
}

@media (prefers-reduced-motion: reduce) {
  .lint-button {
    transition: none;
  }
}
</style>

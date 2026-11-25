<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
withDefaults(defineProps<{ value: string; disabled?: boolean; asChild?: boolean }>(), {
  disabled: false,
  asChild: false,
});
defineSlots<{ default(): unknown; icon?(): unknown }>();
</script>

<template>
  <button data-part="Trigger" role="tab" :disabled="disabled" :data-value="value">
    <slot name="icon" />
    <slot />
  </button>
</template>

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzDialogContent" });
withDefaults(defineProps<{ size?: "sm" | "md" | "lg" }>(), { size: "md" });
defineSlots<{ default(): unknown; footer?(): unknown }>();
</script>

<template>
  <div data-part="Content" role="dialog" aria-modal="true" :data-size="size">
    <slot />
    <footer><slot name="footer" /></footer>
  </div>
</template>

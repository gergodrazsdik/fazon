<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzTabs" });
const value = defineModel<string>();
withDefaults(defineProps<{ orientation?: "horizontal" | "vertical"; activation?: "automatic" | "manual" }>(), {
  orientation: "horizontal",
  activation: "automatic",
});
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div data-part="Tabs" :data-value="value"><slot /></div>
</template>

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzDialog" });
const open = defineModel<boolean>("open", { default: false });
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div data-part="Dialog" :data-open="open || undefined"><slot /></div>
</template>

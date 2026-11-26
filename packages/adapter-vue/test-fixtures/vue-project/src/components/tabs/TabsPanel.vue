<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzTabsPanel" });
defineProps<{ value: string }>();
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div data-part="Panel" role="tabpanel" :data-value="value"><slot /></div>
</template>

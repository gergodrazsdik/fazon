<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineProps<{ label: string }>();
defineSlots<{ default?(): unknown }>();
</script>

<template>
  <div data-part="List" role="tablist" :aria-label="label"><slot /></div>
</template>

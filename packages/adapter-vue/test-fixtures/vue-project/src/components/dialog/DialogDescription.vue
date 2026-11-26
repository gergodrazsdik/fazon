<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzDialogDescription" });
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div data-part="Description"><slot /></div>
</template>

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzDialogTitle" });
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div data-part="Title"><slot /></div>
</template>

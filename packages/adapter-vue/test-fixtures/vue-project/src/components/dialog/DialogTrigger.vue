<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzDialogTrigger" });
defineSlots<{ default(): unknown }>();
</script>

<template>
  <div data-part="Trigger"><slot /></div>
</template>

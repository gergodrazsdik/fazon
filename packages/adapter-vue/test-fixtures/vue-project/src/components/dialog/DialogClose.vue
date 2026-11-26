<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
defineOptions({ name: "FzDialogClose" });
withDefaults(defineProps<{ label?: string }>(), { label: "Close" });
</script>

<template>
  <button data-part="Close" :aria-label="label">×</button>
</template>

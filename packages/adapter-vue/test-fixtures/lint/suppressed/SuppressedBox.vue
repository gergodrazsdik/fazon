<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
// eslint-disable-next-line prefer-const
let label = "Saved";
// @ts-expect-error: a string where a number belongs
const count: number = "1";
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="suppressed-box" v-html="label" />
  <!-- @vue-ignore -->
  <span>{{ count }}</span>
</template>

<style scoped>
/* stylelint-disable-next-line fazon/raw-value */
.suppressed-box {
  color: red;
}
</style>

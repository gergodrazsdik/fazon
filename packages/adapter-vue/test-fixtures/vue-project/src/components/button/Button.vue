<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost";
    size?: "sm" | "md" | "lg";
    disabled?: boolean;
    loading?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "primary", size: "md", disabled: false, loading: false, type: "button" },
);
const emit = defineEmits<{ click: [] }>();
defineSlots<{ default(): unknown; icon?(): unknown }>();
const element = ref<HTMLButtonElement>();
defineExpose({ focus: () => element.value?.focus() });
</script>

<template>
  <button
    ref="element"
    data-part="Button"
    :type="props.type"
    :data-variant="props.variant"
    :data-size="props.size"
    :disabled="props.disabled"
    @click="emit('click')"
  >
    <slot name="icon" />
    <slot />
  </button>
</template>

// SPDX-License-Identifier: GPL-3.0-or-later
import type { Adapter } from "@fazon/core";
import { vueAdapter } from "@fazon/adapter-vue";

/** The adapters this CLI ships, one per `adapter` value fazon.yaml may name. */
export const adapters: readonly Adapter[] = [vueAdapter];

export function findAdapter(id: string): Adapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}

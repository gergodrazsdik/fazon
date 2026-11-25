// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * What a framework adapter supplies to the core (docs/spec/adapter-boundary.md).
 * The capabilities arrive with the steps that need them; the core never imports an adapter.
 */
export interface Adapter {
  /** The adapter's ID, as `adapter` in fazon.yaml names it. */
  readonly id: string;
  /** The framework the adapter targets, for messages. */
  readonly framework: string;
}

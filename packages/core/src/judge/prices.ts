// SPDX-License-Identifier: GPL-3.0-or-later
// The framework's price table and the cost of a judge call (docs/spec/judge.md#cost): from the
// API's usage and the price, in USD per million tokens, that the config or this table gives.
import type { ModelPrice } from "../config/types.js";
import type { TokenUsage } from "../records/run-record.js";

/** List prices, USD per million tokens; 5-minute cache writes. The config's `prices` override them. */
export const frameworkPrices: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
});

/** The price of a model: the config's, else the framework's, else undefined (CONFIG-005). */
export function priceOf(prices: Readonly<Record<string, ModelPrice>>, model: string): ModelPrice | undefined {
  return Object.hasOwn(prices, model)
    ? prices[model]
    : Object.hasOwn(frameworkPrices, model)
      ? frameworkPrices[model]
      : undefined;
}

/**
 * A call's cost. Cache reads and writes without their own price cost 0.1 and 1.25 times the
 * input price, as the API bills them. `discount` is the share paid: 0.5 through the Message
 * Batches API.
 */
export function costOf(tokens: TokenUsage, price: ModelPrice, discount = 1): number {
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const usd =
    tokens.input * price.input +
    tokens.output * price.output +
    (tokens.cacheRead ?? 0) * cacheRead +
    (tokens.cacheWrite ?? 0) * cacheWrite;
  return (usd / 1_000_000) * discount;
}

/** The sum of several calls' tokens. */
export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: (a.cacheRead ?? 0) + (b.cacheRead ?? 0),
    cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
  };
}

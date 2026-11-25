// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { vueAdapter } from "./index.js";
import { withOneTrailingNewline, withoutTrailingNewlines } from "./text.js";

describe("trailing newlines", () => {
  it.each([
    ["", ""],
    ["\n\n", ""],
    ["a", "a"],
    ["a\n", "a"],
    ["a\n\n\n", "a"],
    ["\na\n\nb\n\n", "\na\n\nb"],
    ["a\r\n", "a\r"],
  ])("%j without them is %j", (text, expected) => {
    expect(withoutTrailingNewlines(text)).toBe(expected);
    expect(withOneTrailingNewline(text)).toBe(`${expected}\n`);
  });

  it("are stripped in linear time from a long run of newlines that isn't at the end", () => {
    const text = `${"\n".repeat(100_000)}x`;
    const started = performance.now();
    expect(withOneTrailingNewline(text)).toBe(`${text}\n`);
    expect(withoutTrailingNewlines(`${text}${"\n".repeat(100_000)}`)).toBe(text);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("let the entry file's exports be added after a long run of newlines quickly", async () => {
    const text = `${"\n".repeat(100_000)}export const x = 1;\n\n\n`;
    const started = performance.now();
    const entry = await vueAdapter.entryFile({ file: "src/index.ts", text, components: [] });
    expect(entry.startsWith(`${"\n".repeat(100_000)}export const x = 1;\n\n// fazon:exports:begin`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

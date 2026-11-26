// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseSpecFile } from "../spec/load.js";
import type { Spec } from "../spec/types.js";
import { approvedApi, canonicalJson, hashApi, hashFile } from "./hash.js";

const examples = fileURLToPath(new URL("../../../../docs/spec/examples/specs/valid/", import.meta.url));

async function exampleSpec(name: string): Promise<Spec> {
  const file = parseSpecFile(`specs/${name}.md`, await readFile(path.join(examples, `${name}.md`), "utf8"));
  if (file.spec === undefined) throw new Error(`the example ${name} doesn't parse`);
  return file.spec;
}

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("canonical JSON (RFC 8785)", () => {
  it("matches the RFC's example", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    ) as unknown;
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units, at every depth, and leaves undefined members out", () => {
    expect(canonicalJson({ b: { y: 1, x: [{ d: 1, c: 2 }] }, a: undefined, A: "z", "€": 1, "😀": 2 })).toBe(
      '{"A":"z","b":{"x":[{"c":2,"d":1}],"y":1},"€":1,"😀":2}',
    );
  });

  it("refuses what JSON can't hold", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/no JSON form/);
    expect(() => canonicalJson({ a: Infinity })).toThrow(/no JSON form/);
    expect(() => canonicalJson(1n)).toThrow(/bigint/);
  });
});

describe("the approved API's hash", () => {
  it("covers the API fields, and parts without their states, produce and a11y", async () => {
    const dialog = await exampleSpec("dialog");
    const api = approvedApi(dialog);
    expect(
      Object.keys(api).every((key) =>
        ["props", "events", "slots", "methods", "forward", "form", "parts", "extensions"].includes(key),
      ),
    ).toBe(true);
    expect(api).not.toHaveProperty("name");
    expect(api).not.toHaveProperty("fixtures");
    const parts = api.parts as Record<string, Record<string, unknown>>;
    expect(Object.keys(parts).length).toBeGreaterThan(0);
    for (const part of Object.values(parts)) {
      expect(part).not.toHaveProperty("states");
      expect(part).not.toHaveProperty("produce");
      expect(part).not.toHaveProperty("a11y");
      expect(part).toHaveProperty("parent");
    }
  });

  it("is the SHA-256 of the canonical JSON, and changes only with the API", async () => {
    const button = await exampleSpec("button");
    expect(hashApi(button)).toBe(
      `sha256:${createHash("sha256")
        .update(canonicalJson(approvedApi(button)))
        .digest("hex")}`,
    );
    expect(hashApi(button)).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Key order, the summary, fixtures, states and a11y aren't the API.
    const reordered = Object.fromEntries(Object.entries(button).reverse()) as unknown as Spec;
    expect(hashApi(reordered)).toBe(hashApi(button));
    expect(hashApi({ ...button, summary: "Something else.", fixtures: {}, states: [], a11y: {} })).toBe(
      hashApi(button),
    );
    expect(hashApi({ ...button, props: {} })).not.toBe(hashApi(button));
    expect(hashApi({ ...button, forward: "Label" })).not.toBe(hashApi(button));
  });

  it("ignores a part's states, produce and a11y, but not its other fields", async () => {
    const dialog = await exampleSpec("dialog");
    const [name, part] = Object.entries(dialog.parts ?? {})[0] ?? [];
    if (name === undefined || part === undefined) throw new Error("the example Dialog has no part");
    const withParts = (changed: object) => ({ ...dialog, parts: { ...dialog.parts, [name]: { ...part, ...changed } } });
    expect(hashApi(withParts({ states: ["something"], produce: {}, a11y: { role: "note" } }))).toBe(hashApi(dialog));
    expect(hashApi(withParts({ description: "Changed." }))).not.toBe(hashApi(dialog));
  });
});

describe("a file's hash", () => {
  it("is the hash of its text with LF line endings", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-hash-"));
    await writeFile(path.join(root, "lf.md"), "a\nb\n");
    await writeFile(path.join(root, "crlf.md"), "a\r\nb\r\n");
    const lf = await hashFile(path.join(root, "lf.md"));
    expect(await hashFile(path.join(root, "crlf.md"))).toBe(lf);
    expect(lf).toBe(`sha256:${createHash("sha256").update("a\nb\n").digest("hex")}`);
  });
});

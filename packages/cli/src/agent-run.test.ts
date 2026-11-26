// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { refreshedFile } from "./agent-run.js";

describe("the files the refresh writes between calls", () => {
  const refreshed = refreshedFile("src/components/badge", "src/index.ts");

  it("are the component's generated/ directory and the package entry file", () => {
    expect(refreshed("src/components/badge/generated/stories.json")).toBe(true);
    expect(refreshed("src/index.ts")).toBe(true);
  });

  it("aren't the component's own files, or another component's generated files", () => {
    expect(refreshed("src/components/badge/Badge.vue")).toBe(false);
    expect(refreshed("src/components/badge-group/generated/stories.json")).toBe(false);
    expect(refreshed("src/components/link/generated/stories.json")).toBe(false);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { formatVersions } from "./index.js";

describe("formatVersions", () => {
  it("reads version 0 of the spec and config formats", () => {
    expect(formatVersions).toEqual({ spec: 0, config: 0 });
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { vueAdapter } from "./index.js";

describe("vueAdapter", () => {
  it("is the adapter that fazon.yaml names `vue`", () => {
    expect(vueAdapter.id).toBe("vue");
  });
});

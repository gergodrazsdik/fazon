// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { run } from "./run.js";

function capture(args: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const code = run(args, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

describe("run", () => {
  it("prints help and exits 0 without arguments", () => {
    const result = capture([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: fazon");
    expect(result.stdout).toContain("vue (Vue 3)");
  });

  it("prints the version", () => {
    expect(capture(["--version"]).stdout).toBe("0.0.0\n");
  });

  it("refuses an unknown command with exit code 2", () => {
    const result = capture(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command or option: frobnicate");
  });
});

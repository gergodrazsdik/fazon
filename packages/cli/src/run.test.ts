// SPDX-License-Identifier: GPL-3.0-or-later
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { commands } from "./commands.js";
import { capture, captureJson } from "./test-support.js";

const machine = { cwd: tmpdir() };
const notImplemented = commands.filter((command) => command.run === undefined);

describe("help and version", () => {
  it("prints help and exits 0 without arguments", async () => {
    const result = await capture([], machine);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: fazon");
    expect(result.stdout).toContain("vue (Vue 3)");
    expect(result.stderr).toBe("");
  });

  it("lists every command of the CLI reference, marking those not implemented yet", async () => {
    const { stdout } = await capture(["--help"], machine);
    for (const command of commands) {
      expect(stdout).toContain(`  ${command.name} `);
    }
    expect(stdout).toContain("generate");
    expect(stdout).toMatch(/generate +.*\(not implemented yet: M2\)/);
    expect(stdout).not.toMatch(/doctor +.*not implemented/);
  });

  it("prints the version", async () => {
    expect((await capture(["--version"], machine)).stdout).toBe("0.0.0\n");
  });

  it("prints a command's usage", async () => {
    const result = await capture(["spec", "check", "--help"], machine);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: fazon spec check [<component>...]");
  });

  it("answers --json for help and version too", async () => {
    expect((await captureJson(["--version"], machine)).json).toMatchObject({
      command: "fazon",
      status: "ok",
      result: { version: "0.0.0" },
    });
    expect((await captureJson(["doctor", "--help"], machine)).json).toMatchObject({ command: "doctor", status: "ok" });
  });
});

describe("usage errors", () => {
  it("refuses an unknown command with exit code 2, and says where the list is", async () => {
    const result = await capture(["frobnicate"], machine);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error: 'frobnicate' isn't a fazon command. Run 'fazon --help' for the list.");
  });

  it("refuses an unknown option, with the command's usage to look at", async () => {
    const { code, json } = await captureJson(["doctor", "--frobnicate"], machine);
    expect(code).toBe(2);
    expect(json).toMatchObject({ command: "doctor", status: "refused" });
    expect(JSON.stringify(json.messages)).toContain("fazon doctor --help");
  });

  it("refuses arguments a command doesn't take", async () => {
    const { code, stderr } = await capture(["doctor", "extra"], machine);
    expect(code).toBe(2);
    expect(stderr).toContain("fazon doctor doesn't take 'extra'");
  });

  it("refuses a group without its subcommand, naming the subcommands", async () => {
    const { code, json } = await captureJson(["spec"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      { level: "error", text: "fazon spec needs a subcommand: new or check.", hint: "fazon spec --help" },
    ]);
  });
});

describe("commands not implemented yet", () => {
  it.each(notImplemented.map((command) => [command.name, command.arrives ?? ""]))(
    "fazon %s refuses with exit code 2 and says when it arrives (%s)",
    async (name, arrives) => {
      const { code, json } = await captureJson([...name.split(" "), "button"], machine);
      expect(code).toBe(2);
      expect(json).toMatchObject({ command: name, status: "refused", exitCode: 2 });
      const [message] = json.messages as { text: string }[];
      expect(message?.text).toContain(`fazon ${name} is not implemented yet; it arrives in ${arrives}.`);
      expect(message?.text).toContain("doctor, spec new, spec check");
    },
  );
});

describe("colours", () => {
  it("colours the level when the terminal can show it", async () => {
    expect((await capture(["frobnicate"], machine, true)).stderr).toContain("\u001b[31merror:");
  });

  it("leaves colours out with --no-color or NO_COLOR", async () => {
    expect((await capture(["frobnicate", "--no-color"], machine, true)).stderr).not.toContain("\u001b[");
    expect((await capture(["frobnicate"], { ...machine, env: { NO_COLOR: "1" } }, true)).stderr).not.toContain(
      "\u001b[",
    );
  });
});

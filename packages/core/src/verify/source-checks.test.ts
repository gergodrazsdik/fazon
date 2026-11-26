// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter, SourceCommand, SourceCommands } from "../adapter.js";
import type { SyncResult } from "../sync/sync.js";
import { exportFindings, readPackedPackage, stylesFindings } from "./package-check.js";
import {
  generatedFindings,
  runSourceChecks,
  testFindings,
  typeFindings,
  type CommandResult,
  type CommandRunner,
} from "./source-checks.js";
import { exampleButton } from "./test-support.js";

/** A gzipped tar archive of files under `package/`, as `npm pack` writes it. */
export function tarball(files: Readonly<Record<string, string>>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    const field = (value: string, offset: number, length: number) => {
      header.write(value, offset, length, "ascii");
    };
    field(`package/${name}`, 0, 100);
    field("0000644\0", 100, 8);
    field("0000000\0", 108, 8);
    field("0000000\0", 116, 8);
    field(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12);
    field("00000000000\0", 136, 12);
    field("        ", 148, 8);
    field("0", 156, 1);
    field("ustar\0", 257, 6);
    field("00", 263, 2);
    let sum = 0;
    for (const byte of header) sum += byte;
    field(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

const goodPackage = {
  "package.json": JSON.stringify({
    name: "library",
    version: "1.0.0",
    type: "module",
    license: "MIT",
    files: ["index.js", "index.d.ts", "style.css"],
    sideEffects: ["*.css"],
    exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./style.css": "./style.css" },
  }),
  "index.js": "export const Button = {};\n",
  "index.d.ts": "export declare const Button: object;\n",
  "style.css": ".button {}\n",
};

const commands: SourceCommands = {
  compile: [{ package: "vite", args: ["build"] }],
  types: { package: "vue-tsc", args: ["--noEmit"] },
  storybook: { package: "storybook", args: ["build"] },
  eslint: { package: "eslint", args: [] },
  stylelint: { package: "stylelint", args: [] },
  test: { package: "vitest", args: ["run"] },
  pack: { program: "npm", args: ["pack"] },
  typesResolutions: ["bundler"],
};

const adapter = {
  testRule: (file: string, name: string) =>
    file.endsWith(".contract.test.ts")
      ? name.includes("contract-api")
        ? "contract-api"
        : "contract-render"
      : "behaviour",
  componentFiles: () => ({ files: [{ name: "Button", exportName: "Button", file: "Button.vue" }], patterns: [] }),
} as unknown as Adapter;

const ok: CommandResult = { exitCode: 0, stdout: "", stderr: "" };
const syncOk: SyncResult = {
  ok: true,
  changes: [],
  unchanged: 3,
  components: ["button"],
  orphanedComponents: [],
  pending: [],
};

let root: string;
let reports: { eslint: string; stylelint: string; test: string };
let packDir: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fazon-source-"));
  reports = {
    eslint: path.join(root, "reports/eslint.json"),
    stylelint: path.join(root, "reports/stylelint.json"),
    test: path.join(root, "reports/vitest.json"),
  };
  packDir = path.join(root, "package");
  await mkdir(path.join(root, "reports"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const vitestReport = (results: { file: string; name: string; status: string; message?: string }[]) => ({
  testResults: [...new Set(results.map((r) => r.file))].map((file) => ({
    name: path.join(root, file),
    status: results.some((r) => r.file === file && r.status === "failed") ? "failed" : "passed",
    assertionResults: results
      .filter((r) => r.file === file)
      .map((r) => ({
        fullName: r.name,
        status: r.status,
        failureMessages: r.message === undefined ? [] : [r.message],
      })),
  })),
});

/** A runner whose tools pass, writing their reports; `override` replaces one command's result by its label. */
function runner(override: Record<string, (command: SourceCommand) => Promise<CommandResult>> = {}): {
  run: CommandRunner;
  labels: string[];
} {
  const labels: string[] = [];
  const run: CommandRunner = async (command, options) => {
    labels.push(options.label);
    const custom = override[options.label];
    if (custom !== undefined) return custom(command);
    switch (options.label) {
      case "lint-eslint":
        await writeFile(
          reports.eslint,
          JSON.stringify([{ filePath: path.join(root, "src/components/button/Button.vue"), messages: [] }]),
        );
        return ok;
      case "lint-stylelint":
        await writeFile(
          reports.stylelint,
          JSON.stringify([{ source: path.join(root, "src/components/button/Button.vue"), warnings: [] }]),
        );
        return ok;
      case "test":
        await writeFile(
          reports.test,
          JSON.stringify(
            vitestReport([
              {
                file: "src/components/button/generated/button.contract.test.ts",
                name: "Button: contract-api matches",
                status: "passed",
              },
              { file: "src/components/button/Button.test.ts", name: "emits click", status: "passed" },
            ]),
          ),
        );
        return ok;
      case "package-pack":
        await mkdir(packDir, { recursive: true });
        await writeFile(path.join(packDir, "library-1.0.0.tgz"), tarball(goodPackage));
        return ok;
      case "package-import":
        return { exitCode: 0, stdout: JSON.stringify(["Button"]), stderr: "" };
      default:
        return ok;
    }
  };
  return { run, labels };
}

describe("the source checks", () => {
  it("pass when every tool does, in the order of the catalogue", async () => {
    const button = await exampleButton();
    const { run, labels } = runner();
    const result = await runSourceChecks({
      root,
      components: [button],
      adapter,
      commands,
      reports,
      packDir,
      run,
      generated: () => Promise.resolve(syncOk),
    });
    expect(result.storybook).toBe(true);
    expect(result.checks.map((c) => [c.check, c.status, c.findings])).toEqual([
      ["build", "pass", []],
      ["lint", "pass", []],
      ["test", "pass", []],
      ["package", "pass", []],
    ]);
    expect(labels).toEqual([
      "build-compile-1",
      "build-types",
      "build-storybook",
      "lint-eslint",
      "lint-stylelint",
      "test",
      "package-pack",
      "package-import",
    ]);
  }, 60_000);

  it("report every failure at once, and skip package when the library build failed", async () => {
    const button = await exampleButton();
    const { run, labels } = runner({
      "build-compile-1": () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "\u001b[31mRollup failed\u001b[0m" }),
      "build-types": () =>
        Promise.resolve({
          exitCode: 2,
          stdout:
            "src/components/button/Button.vue(12,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
          stderr: "",
        }),
      "build-storybook": () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "storybook broke" }),
      "lint-eslint": () => Promise.resolve({ exitCode: 2, stdout: "", stderr: "Oops! Something went wrong" }),
      test: async () => {
        await writeFile(
          reports.test,
          JSON.stringify(
            vitestReport([
              {
                file: "src/components/button/generated/button.contract.test.ts",
                name: "Button: contract-api matches",
                status: "failed",
                message: "AssertionError: size\n  at x",
              },
            ]),
          ),
        );
        return { exitCode: 1, stdout: "", stderr: "" };
      },
    });
    const result = await runSourceChecks({
      root,
      components: [button],
      adapter,
      commands,
      reports,
      packDir,
      run,
      generated: () =>
        Promise.resolve({
          ...syncOk,
          changes: [{ path: "src/components/button/generated/stories.json", change: "modified" }],
        }),
    });
    expect(result.storybook).toBe(false);
    const [build, lint, test, pkg] = result.checks;
    expect(build?.findings.map((f) => [f.rule, f.file, f.line])).toEqual([
      ["compile", undefined, undefined],
      ["types", "src/components/button/Button.vue", 12],
      ["storybook", undefined, undefined],
      ["generated", "src/components/button/generated/stories.json", undefined],
    ]);
    expect(build?.findings[0]?.message).toContain("Rollup failed");
    expect(build?.findings[0]?.message).not.toContain("\u001b");
    expect(lint).toMatchObject({ status: "error", findings: [] });
    expect(lint?.message).toContain("Something went wrong");
    expect(test?.findings.map((f) => [f.rule, f.message])).toEqual([
      ["contract-api", "Button: contract-api matches: AssertionError: size"],
      ["missing-behaviour", expect.stringContaining("Button has no behaviour test") as string],
    ]);
    expect(pkg).toMatchObject({ status: "skipped", findings: [] });
    expect(labels).not.toContain("package-pack");
  }, 60_000);
});

describe("the source checks' readers", () => {
  it("read TypeScript's diagnostics, relative to the root", () => {
    expect(typeFindings("/r/src/a.ts(3,14): error TS2322: Wrong.\nnoise\n", "/r")).toEqual([
      {
        check: "build",
        rule: "types",
        message: "TS2322: Wrong.",
        file: "src/a.ts",
        line: 3,
        column: 14,
        blocking: true,
      },
    ]);
  });

  it("read the problems that stop sync as generated findings", () => {
    expect(
      generatedFindings({
        ok: false,
        problems: [{ rule: "SPEC-002", file: "specs/button.md", line: 4, message: "bad" }],
      }),
    ).toEqual([
      {
        check: "build",
        rule: "generated",
        message: "fazon sync can't generate the files: SPEC-002 bad",
        file: "specs/button.md",
        line: 4,
        blocking: true,
      },
    ]);
  });

  it("map a test file that fails to run to its rule, and count skipped tests as no behaviour test", async () => {
    const button = await exampleButton();
    const findings = testFindings(
      [
        {
          name: "/r/src/components/button/generated/button.contract.test.ts",
          status: "failed",
          message: "SyntaxError: x",
          assertionResults: [],
        },
        {
          name: "/r/src/components/button/Button.test.ts",
          status: "skipped",
          assertionResults: [{ fullName: "later", status: "skipped" }],
        },
      ],
      "/r",
      [button],
      (file, name) => adapter.testRule(file, name),
    );
    expect(findings.map((f) => f.rule)).toEqual(["contract-render", "missing-behaviour"]);
  });
});

describe("the package check", () => {
  it("reads the packed tarball", () => {
    const pkg = readPackedPackage(tarball(goodPackage));
    expect(pkg.name).toBe("library");
    expect(pkg.files).toEqual(["index.d.ts", "index.js", "package.json", "style.css"]);
    expect(pkg.entryText).toBe(goodPackage["index.js"]);
  });

  it("finds a component the entry leaves out (export)", () => {
    const components = [{ file: "src/components/button/Button.vue", exports: ["Button", "ButtonIcon"] }];
    expect(exportFindings({ ok: true, names: ["Button"] }, components)).toEqual([
      expect.objectContaining({ rule: "export", file: "src/components/button/Button.vue", expected: "ButtonIcon" }),
    ]);
    expect(exportFindings({ ok: false, error: "Cannot find module" }, components)).toEqual([
      expect.objectContaining({ rule: "export", message: expect.stringContaining("Cannot find module") as string }),
    ]);
  });

  it("finds styles the package doesn't ship or doesn't reach (styles)", () => {
    const pkg = readPackedPackage(tarball(goodPackage));
    expect(stylesFindings(pkg)).toEqual([]);
    expect(stylesFindings({ ...pkg, files: ["index.js", "package.json"] })).toEqual([
      expect.objectContaining({ rule: "styles", message: expect.stringContaining("no stylesheet") as string }),
    ]);
    expect(stylesFindings({ ...pkg, manifest: { ...pkg.manifest, exports: { ".": "./index.js" } } })).toEqual([
      expect.objectContaining({ rule: "styles" }),
    ]);
    expect(
      stylesFindings({
        ...pkg,
        manifest: { ...pkg.manifest, exports: { ".": "./index.js" } },
        entryText: 'import "./style.css";',
      }),
    ).toEqual([]);
  });

  it("runs publint (manifest) and Are the Types Wrong (types) on the tarball", async () => {
    const { manifestFindings, typesFindings } = await import("./package-check.js");
    const good = readPackedPackage(tarball(goodPackage));
    expect(await manifestFindings(good)).toEqual([]);
    expect(await typesFindings(good)).toEqual([]);
    const broken = readPackedPackage(
      tarball({
        "index.js": goodPackage["index.js"],
        "style.css": goodPackage["style.css"],
        "other.d.ts": "export {};\n",
        "package.json": JSON.stringify({
          ...(JSON.parse(goodPackage["package.json"]) as object),
          exports: { ".": { default: "./index.js", types: "./missing.d.ts" } },
        }),
      }),
    );
    expect((await manifestFindings(broken)).map((f) => f.rule)).toContain("manifest");
    expect((await typesFindings(broken)).map((f) => f.rule)).toContain("types");
  }, 60_000);
});

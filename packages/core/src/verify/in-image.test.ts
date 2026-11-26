// SPDX-License-Identifier: GPL-3.0-or-later
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPackage, makeWorkingCopy, playwrightProblems, processRunner } from "./in-image.js";
import { readStorybookIndex, serveDirectory } from "./storybook.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fazon-in-image-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

/** A Playwright package that needs Chromium build `revision`. */
async function playwright(directory: string, version: string, revision: string): Promise<void> {
  await write(`${directory}/package.json`, JSON.stringify({ name: path.basename(directory), version }));
  await write(
    `${directory}/browsers.json`,
    JSON.stringify({
      browsers: [
        { name: "chromium", revision },
        { name: "chromium-headless-shell", revision },
        { name: "firefox", revision: "1" },
      ],
    }),
  );
}

describe("the Playwright check", () => {
  it("passes when the image carries the Chromium builds the repository's Playwright and Fazon's need", async () => {
    const own = await findPackage(path.dirname(new URL(import.meta.url).pathname), "playwright-core");
    const browsers = JSON.parse(await readFile(path.join(own ?? "", "browsers.json"), "utf8")) as {
      browsers: { name: string; revision: string }[];
    };
    const revision = browsers.browsers.find((b) => b.name === "chromium")?.revision ?? "";
    await playwright("repo/node_modules/playwright", "1.65.1", revision);
    await playwright("repo/node_modules/playwright-core", "1.65.1", revision);
    await mkdir(path.join(root, "browsers", `chromium-${revision}`), { recursive: true });
    await mkdir(path.join(root, "browsers", `chromium_headless_shell-${revision}`), { recursive: true });
    expect(await playwrightProblems(path.join(root, "repo"), path.join(root, "browsers"))).toEqual([]);

    await playwright("repo/node_modules/playwright-core", "1.70.0", "9999");
    expect(await playwrightProblems(path.join(root, "repo"), path.join(root, "browsers"))).toEqual([
      expect.stringContaining(
        "The repository's Playwright is version 1.70.0, which needs chromium build 9999",
      ) as string,
      expect.stringContaining("needs chromium-headless-shell build 9999") as string,
    ]);
  });

  it("fails when the repository doesn't install Playwright", async () => {
    await mkdir(path.join(root, "repo"), { recursive: true });
    expect((await playwrightProblems(path.join(root, "repo"), path.join(root, "browsers")))[0]).toMatch(
      /doesn't install Playwright/,
    );
  });
});

describe("the working copy", () => {
  it("copies the repository without node_modules, .git, .fazon or what's skipped, and links its dependencies", async () => {
    await write("repo/src/a.ts", "a");
    await write("repo/.git/HEAD", "ref");
    await write("repo/.fazon/runs/x/run.json", "{}");
    await write("repo/.fazon-framework/abc/package.json", "{}");
    await write("repo/baselines/light/a.png", "png");
    await write("repo/node_modules/vite/package.json", "{}");
    await write("repo/node_modules/@scope/tool/package.json", "{}");
    const work = path.join(root, "work");
    await makeWorkingCopy(path.join(root, "repo"), work, ["baselines"]);
    expect(await readFile(path.join(work, "src/a.ts"), "utf8")).toBe("a");
    for (const missing of [".git", ".fazon", ".fazon-framework", "baselines"]) {
      await expect(lstat(path.join(work, missing))).rejects.toThrow();
    }
    expect((await lstat(path.join(work, "node_modules"))).isDirectory()).toBe(true);
    expect(await readlink(path.join(work, "node_modules/vite"))).toBe(path.join(root, "repo/node_modules/vite"));
    expect(await readlink(path.join(work, "node_modules/@scope/tool"))).toBe(
      path.join(root, "repo/node_modules/@scope/tool"),
    );
  });
});

describe("the command runner", () => {
  it("runs a dependency's executable with Node.js and logs its output", async () => {
    await write("repo/node_modules/tool/package.json", JSON.stringify({ name: "tool", bin: { tool: "cli.js" } }));
    await write(
      "repo/node_modules/tool/cli.js",
      "console.log(process.argv.slice(2).join(' ')); process.exitCode = 3;\n",
    );
    const run = processRunner(path.join(root, "run"), process.env);
    const result = await run({ package: "tool", args: ["a", "b"] }, { cwd: path.join(root, "repo"), label: "tool" });
    expect(result).toMatchObject({ exitCode: 3, stdout: "a b\n" });
    expect(await readFile(path.join(root, "run/logs/tool.log"), "utf8")).toContain("a b\n");
    expect(
      await run({ package: "missing", args: [] }, { cwd: path.join(root, "repo"), label: "missing" }),
    ).toMatchObject({
      exitCode: 127,
    });
  });
});

describe("the static Storybook build", () => {
  it("is served on the loopback interface, without leaving its directory", async () => {
    await write("sb/index.html", "<p>story</p>");
    await write(
      "sb/index.json",
      JSON.stringify({
        entries: {
          a: { id: "button--a", title: "Button", type: "story" },
          d: { id: "button--docs", title: "Button", type: "docs" },
        },
      }),
    );
    await write("secret.txt", "no");
    const server = await serveDirectory(path.join(root, "sb"));
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const page = await fetch(`${server.url}/`);
      expect(page.headers.get("content-type")).toMatch(/text\/html/);
      expect(await page.text()).toBe("<p>story</p>");
      expect((await fetch(`${server.url}/%2e%2e/secret.txt`)).status).not.toBe(200);
      expect((await fetch(`${server.url}/missing.js`)).status).toBe(404);
    } finally {
      await server.close();
    }
    expect(await readStorybookIndex(path.join(root, "sb"))).toEqual(new Map([["Button", ["button--a"]]]));
  });
});

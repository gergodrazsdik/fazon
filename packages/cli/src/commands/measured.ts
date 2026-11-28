// SPDX-License-Identifier: GPL-3.0-or-later
// What `fazon measure` and `fazon calibrate` refuse alike (docs/spec/cli.md#fazon-measure): a local
// config, whose overrides would change what's measured, and a checkout with uncommitted changes.
import { access } from "node:fs/promises";
import path from "node:path";
import { localConfigFileName } from "@fazon/core";
import { refused, type Outcome } from "../outcome.js";
import type { Context } from "./context.js";

/** A refusal (2), or an environment error (3) when git can't run; undefined when the checkout can be measured. */
export async function measuredCheckoutProblem(context: Context, what: string): Promise<Outcome | undefined> {
  const { environment } = context;
  const repo = environment.cwd;
  const local = await access(path.join(repo, localConfigFileName)).then(
    () => true,
    () => false,
  );
  if (local) {
    return refused(
      `${what} runs without ${localConfigFileName}: its overrides would change what's measured. Move it aside first.`,
    );
  }
  const status = await environment.exec("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repo });
  if (status?.exitCode !== 0) {
    return {
      status: "error",
      messages: [{ level: "error", text: `git status failed: ${what} needs a git checkout.` }],
    };
  }
  if (status.stdout.trim() !== "") {
    return refused(`${what} runs from a clean checkout: commit or stash the changes first.`, "git status");
  }
  return undefined;
}

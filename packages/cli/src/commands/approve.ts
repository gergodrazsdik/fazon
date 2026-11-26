// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon approve <component>` (docs/spec/cli.md#fazon-approve): decision 1. The spec passes
// `spec check`, then the hash of its API and today's date go into the component's provenance file.
import path from "node:path";
import {
  approveApi,
  approvedApi,
  hashApi,
  hashFile,
  provenancePath,
  readProvenance,
  writeProvenance,
} from "@fazon/core";
import { readComponent, specRefusal } from "../agent-run.js";
import { refused, type Message, type Outcome } from "../outcome.js";
import type { Context, Invocation } from "./context.js";

/** `fazon approve <component>`. */
export async function approve(
  invocation: Invocation,
  context: Context,
  now: () => Date = () => new Date(),
): Promise<Outcome> {
  const setup = await readComponent("approve", invocation, context);
  if ("stop" in setup) return setup.stop;
  const { repo, config, component, spec } = setup;
  if (setup.findings.length > 0) {
    return specRefusal(component, setup.findings, `${spec.file} has findings, so its API can't be approved yet`);
  }

  const file = provenancePath(config.paths.components, spec.spec.name);
  const absolute = path.join(repo, file);
  const read = await readProvenance(absolute);
  if (read.kind === "invalid") {
    return refused(
      `${file} isn't a valid provenance file (${read.problems.join("; ")}). Only the harness writes it: restore it from git, or remove it to start the component's provenance over.`,
      `git checkout -- ${file}`,
    );
  }
  const previous = read.kind === "ok" ? read.provenance : undefined;
  const apiHash = hashApi(spec.spec);
  const date = now();
  const provenance = approveApi(previous, {
    component: spec.spec.name,
    specPath: spec.file,
    specHash: await hashFile(path.join(repo, spec.file)),
    apiHash,
    date,
  });
  await writeProvenance(absolute, provenance);

  const messages: Message[] = [];
  if (Object.keys(approvedApi(spec.spec)).length === 0) {
    messages.push({
      level: "warning",
      text: `${spec.file} has no API: no props, events, slots, methods or parts. fazon propose drafts one.`,
      hint: `fazon propose ${component}`,
    });
  }
  const again = previous?.api.hash === apiHash;
  messages.push({
    level: "info",
    text: again
      ? `${spec.spec.name}'s API was approved already, on ${previous.api.approved}; approved again on ${provenance.api.approved}, in ${file}.`
      : `Approved ${spec.spec.name}'s API (${apiHash}) on ${provenance.api.approved}, in ${file}. Commit it with the spec.`,
    hint: `fazon generate ${component}`,
  });
  return {
    status: "ok",
    messages,
    result: {
      component: spec.spec.name,
      spec: spec.file,
      provenance: file,
      apiHash,
      approved: provenance.api.approved,
      ...(previous === undefined || again ? {} : { previousApiHash: previous.api.hash }),
    },
  };
}

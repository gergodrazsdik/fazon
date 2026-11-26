// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon propose <component>` (docs/spec/cli.md#fazon-propose): a propose run. One agent call, which
// can only read, drafts the API from the spec; the harness writes it into the spec's API fields,
// with the rest of the file as it was, for the developer to review as a diff and approve.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyProposal,
  approvedApi,
  checkSpec,
  parseSpecFile,
  proposalSchema,
  proposePrompt,
  readProposal,
  resolveTokenSet,
  roleTokens,
  type AgentCallResult,
  type AppliedProposal,
  type RoleToken,
} from "@fazon/core";
import {
  prepareAgentCommand,
  runAgentCommand,
  runMessages,
  runResult,
  runStatus,
  specRefusal,
  type AgentCommandSetup,
} from "../agent-run.js";
import type { Message, Outcome } from "../outcome.js";
import { describeFinding, type Context, type Invocation } from "./context.js";

/** `fazon propose <component>`. */
export async function propose(invocation: Invocation, context: Context): Promise<Outcome> {
  const setup = await prepareAgentCommand("propose", invocation, context);
  if ("stop" in setup) return setup.stop;
  const { component, spec } = setup;
  // The agent drafts from the spec's content: a spec that `spec check` rejects, or whose
  // placeholders (SPEC-019) are still there, has nothing reliable to draft from.
  if (setup.findings.length > 0) {
    return specRefusal(
      component,
      setup.findings,
      `${spec.file} has findings, so there's nothing reliable to propose from`,
    );
  }

  const messages: Message[] = [];
  const prompted = await promptContext(setup, messages);
  let proposal: AppliedProposal | undefined;
  const answer = (result: AgentCallResult): string | undefined => {
    const read = readProposal(result);
    if ("problem" in read) return read.problem;
    let applied: AppliedProposal;
    try {
      applied = applyProposal(setup.specText, spec.spec, read.api, setup.adapter.id);
    } catch (error) {
      return `the proposed API can't be written into ${spec.file}: ${(error as Error).message}`;
    }
    const file = parseSpecFile(spec.file, applied.text);
    const others = setup.specs.filter((other) => other.file !== spec.file);
    const findings = checkSpec(file, [...others, file], setup.specInputs);
    if (findings.length > 0) {
      const listed = findings.map((finding) => describeFinding(finding, true)).join("; ");
      return `the proposed API breaks ${findings.length === 1 ? "a SPEC rule" : "SPEC rules"}: ${listed}`;
    }
    proposal = applied;
    return undefined;
  };

  const done = await runAgentCommand(
    setup,
    {
      kind: "propose",
      access: "read",
      prompt: (input) =>
        proposePrompt({
          component: spec.spec.name,
          specFile: spec.file,
          specText: setup.specText,
          hasApi: Object.keys(approvedApi(spec.spec)).length > 0,
          specsDirectory: setup.config.paths.specs,
          componentsDirectory: setup.config.paths.components,
          adapter: {
            id: setup.adapter.id,
            framework: setup.adapter.framework,
            ...(setup.adapter.apiMappingText === undefined ? {} : { mapping: setup.adapter.apiMappingText }),
          },
          roleTokens: prompted.roleTokens,
          ...(prompted.conventions === undefined ? {} : { conventions: prompted.conventions }),
          left: input.left,
          callMinutes: input.callMinutes,
        }),
      jsonSchema: proposalSchema(),
      answer,
      proposal: spec.file,
    },
    context,
  );
  if ("stop" in done) return done.stop;

  const passed = done.outcome.record.status === "passed";
  let fields: readonly string[] = [];
  if (passed && proposal !== undefined) {
    // The snapshot after the call showed the spec unchanged (a change would be a violation).
    await writeFile(path.join(setup.repo, spec.file), proposal.text);
    fields = proposal.changed;
    messages.push(
      fields.length === 0
        ? { level: "info", text: `The proposed API is the one ${spec.file} has already: nothing changed.` }
        : {
            level: "info",
            text: `Wrote the proposed API into ${spec.file}: ${fields.join(", ")}. Review it as a diff, edit it if needed, then approve it.`,
            hint: `fazon approve ${component}`,
          },
    );
  }
  return {
    status: runStatus(done),
    messages: [...messages, ...runMessages(done)],
    result: { ...runResult(done), spec: spec.file, fields },
  };
}

/** The role tokens and the conventions doc for the prompt; a warning for each that can't be read. */
async function promptContext(
  setup: AgentCommandSetup,
  messages: Message[],
): Promise<{ roleTokens: readonly RoleToken[]; conventions?: { file: string; text: string } }> {
  const { repo, config } = setup;
  let tokens: readonly RoleToken[] = [];
  try {
    const { tokenSet } = await resolveTokenSet(path.join(repo, config.paths.tokens));
    if (tokenSet === undefined) throw new Error("it doesn't resolve");
    tokens = roleTokens(tokenSet);
  } catch {
    messages.push({
      level: "warning",
      text: `The token set at ${config.paths.tokens} can't be read, so the prompt lists no role tokens.`,
      hint: "fazon sync",
    });
  }
  const file = config.paths.conventions;
  try {
    return { roleTokens: tokens, conventions: { file, text: await readFile(path.join(repo, file), "utf8") } };
  } catch {
    messages.push({ level: "warning", text: `There's no conventions doc at ${file}, so the prompt has none.` });
    return { roleTokens: tokens };
  }
}

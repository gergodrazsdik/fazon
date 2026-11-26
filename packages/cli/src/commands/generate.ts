// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon generate <component> [--clean]` (docs/spec/cli.md#fazon-generate): a generate run. The
// agent writes the component from its approved spec; after each call the harness refreshes the
// component's generated files and runs every check in the verifier image, until an iteration
// passes or a cap is reached. `fazon feedback` runs the same loop with the developer's feedback
// (`prepareLoopCommand`, `runLoopCommand`).
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildReport,
  generatedDirectory,
  generatedRefresh,
  generatePrompt,
  hashApi,
  imageChecksPhase,
  loadGenerateContext,
  noJudge,
  provenancePath,
  readProvenance,
  refreshGenerated,
  refreshScope,
  storybookStoryUrl,
  syncRepository,
  type FeedbackInput,
  type GenerateContext,
} from "@fazon/core";
import {
  prepareAgentCommand,
  runAgentCommand,
  runMessages,
  runResult,
  runStatus,
  specRefusal,
  type AgentCommandSetup,
  type AgentRunDone,
  type Stop,
} from "../agent-run.js";
import { refused, type Message, type Outcome } from "../outcome.js";
import type { Context, Invocation } from "./context.js";
import { generateInImage, prepareImage } from "./generate-image.js";
import { storybookUrlVariable } from "./report.js";
import { problemMessage } from "./sync.js";

/** `fazon generate <component> [--clean]`, and its in-image part (`--in-image <run> --iteration <n>`). */
export async function generate(invocation: Invocation, context: Context): Promise<Outcome> {
  const inImage = invocation.options["in-image"];
  if (typeof inImage === "string") return generateInImage(inImage, invocation, context);
  const setup = await prepareLoopCommand("generate", invocation, context);
  if ("stop" in setup) return setup.stop;
  return runLoopCommand(setup, { kind: "generate", clean: invocation.options.clean === true }, context);
}

/**
 * What `generate` and `feedback` check before their run, in order: the component and its spec,
 * the Claude Code version (3), then refusals (2): a spec with findings, as the checks need specs
 * that pass `spec check`, and a spec whose API isn't the approved one.
 */
export async function prepareLoopCommand(
  command: "generate" | "feedback",
  invocation: Invocation,
  context: Context,
): Promise<AgentCommandSetup | Stop> {
  const setup = await prepareAgentCommand(command, invocation, context);
  if ("stop" in setup) return setup;
  const { repo, config, component, spec } = setup;
  if (setup.findings.length > 0) {
    return {
      stop: specRefusal(
        component,
        setup.findings,
        `${spec.file} has findings, so the component can't be generated from it`,
      ),
    };
  }

  const file = provenancePath(config.paths.components, spec.spec.name);
  const read = await readProvenance(path.join(repo, file));
  if (read.kind === "invalid") {
    return {
      stop: refused(
        `${file} isn't a valid provenance file (${read.problems.join("; ")}), so there's no approved API to generate from. Only the harness writes it: restore it from git, or approve the API again.`,
        `fazon approve ${component}`,
      ),
    };
  }
  if (read.kind === "missing") {
    return {
      stop: refused(
        `${spec.spec.name}'s API isn't approved: ${file} doesn't exist. Review the API in ${spec.file}, then approve it (decision 1).`,
        `fazon approve ${component}`,
      ),
    };
  }
  const apiHash = hashApi(spec.spec);
  if (read.provenance.api.hash !== apiHash) {
    return {
      stop: refused(
        `The API in ${spec.file} isn't the one approved on ${read.provenance.api.approved}: its hash is ${apiHash}, the approved one ${read.provenance.api.hash}. Review the change, then approve it again.`,
        `fazon approve ${component}`,
      ),
    };
  }
  return setup;
}

/** What a loop command's run is: a generate run, or a feedback run with its parent and the developer's text. */
export interface LoopRunRequest {
  readonly kind: "generate" | "feedback";
  /** Removes the component's files outside `generated/` before the run (`generate --clean`). */
  readonly clean?: boolean;
  /** Required for a feedback run, and only there. */
  readonly feedback?: FeedbackInput;
}

/**
 * Runs a generate or feedback run for a prepared command (`prepareLoopCommand`). Once the run
 * lock is held: the pre-flight `fazon sync --check` outside the component (2), the image's
 * environment (3), and `--clean`. Then the loop, with the generate prompt, the generated-files
 * refresh, the checks in the verifier image and, until M3, no judge; and at the end the run's
 * HTML report. A feedback run's result names its parent. Exits 1 when the run needs a person.
 */
export async function runLoopCommand(
  setup: AgentCommandSetup,
  request: LoopRunRequest,
  context: Context,
): Promise<Outcome> {
  const { repo, config, adapter, component, spec, directory } = setup;
  const messages: Message[] = [];
  const feedback = request.feedback;
  if (feedback !== undefined) messages.push(feedbackMessage(feedback));
  const refresh = { root: repo, config, adapter, name: component };
  let removed: readonly string[] | undefined;
  let prompted: GenerateContext | undefined;

  const done = await runAgentCommand(
    setup,
    {
      kind: request.kind,
      approvedApi: true,
      // Read once, on the first call: after the refresh at the run's start, which writes the approved API into generated/.
      prompt: async (input) => {
        prompted ??= await loadGenerateContext(refresh);
        return generatePrompt(prompted, input);
      },
      dependencies: { refreshGenerated: generatedRefresh(refresh), judge: noJudge },
      ...(feedback === undefined ? {} : { feedback }),
      prepare: async () => {
        const stale = await staleOutside(setup);
        if (stale !== undefined) return stale;
        const runImage = await prepareImage(setup, context);
        if ("stop" in runImage) return runImage;
        if (request.clean === true) {
          removed = await cleanComponent(repo, directory);
          messages.push(cleanMessage(directory, removed));
        }
        return {
          dependencies: {
            checks: imageChecksPhase({
              component: spec.spec.name,
              runImage,
              refresh: () => refreshGenerated(refresh),
            }),
          },
        };
      },
    },
    context,
  );
  if ("stop" in done) return done.stop;

  const report = await runReport(setup, done, context, messages);
  messages.push(...runMessages(done), ...endMessages(setup, done, report));
  return {
    status: runStatus(done),
    messages,
    result: {
      ...runResult(done),
      component: spec.spec.name,
      ...(feedback === undefined ? {} : { parent: feedback.parent }),
      ...(report === undefined ? {} : { report }),
      ...(removed === undefined ? {} : { removed }),
    },
  };
}

/** Which run a feedback run answers, and what its prompts carry. */
function feedbackMessage(feedback: FeedbackInput): Message {
  const count = feedback.findings.length;
  const findings =
    count === 0
      ? "that run left no findings that block"
      : `the first also carries the ${String(count)} blocking ${count === 1 ? "finding" : "findings"} of that run's last checks`;
  return {
    level: "info",
    text: `This feedback run answers ${feedback.parent}: every prompt carries your feedback, and ${findings}.`,
  };
}

/**
 * The pre-flight: `fazon sync --check` over everything but what the run's refresh writes (the
 * component's `generated/` directory and the entry file). A stale file there, such as another
 * component's story files or the token CSS, fails the `build` check's rule `generated` in every
 * iteration, and the agent may not fix it, so the run is refused (2) before any call. What stops
 * sync (a spec or the token set) is refused too, as the refresh at the run's start would stop.
 */
async function staleOutside(setup: AgentCommandSetup): Promise<Stop | undefined> {
  const { repo, config, adapter, component, spec } = setup;
  const own = refreshScope(config, component);
  const result = await syncRepository(repo, config, adapter, { check: true, only: (file) => !own(file) });
  if (!result.ok) {
    return {
      stop: {
        status: "refused",
        messages: [
          ...result.problems.map(problemMessage),
          {
            level: "error",
            text: "The generated files can't be refreshed until these problems are fixed, so the run would stop at its start.",
            hint: "fazon sync",
          },
        ],
      },
    };
  }
  if (result.changes.length === 0) return undefined;
  const count = result.changes.length;
  return {
    stop: {
      status: "refused",
      messages: [
        {
          level: "error",
          text: `${String(count)} generated ${count === 1 ? "file" : "files"} outside ${spec.spec.name}'s ${count === 1 ? "differs" : "differ"} from what the specs and the token set give: ${result.changes.map((change) => `${change.path} (${change.change})`).join(", ")}. The build check's rule generated would block every iteration, and the agent may not fix ${count === 1 ? "it" : "them"}: run fazon sync and commit the result first.`,
          hint: "fazon sync",
        },
      ],
    },
  };
}

/** Every file under a directory, relative to `base`, with `/` separators; a link is a file. */
async function listFiles(base: string, relative: string): Promise<string[]> {
  const files: string[] = [];
  const absolute = path.join(base, relative);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(base, child)));
    else files.push(child);
  }
  return files;
}

/**
 * `--clean`: removes everything in the component's directory except its `generated/` directory
 * (the harness's files, provenance included), so the agent starts from nothing. Nothing outside
 * the directory is touched; a link is removed, not what it points to. Returns the files removed,
 * from the repository root, sorted.
 */
export async function cleanComponent(repo: string, directory: string): Promise<string[]> {
  const absolute = path.join(repo, directory);
  let entries: string[];
  try {
    if (!(await lstat(absolute)).isDirectory()) return [];
    entries = await readdir(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const removed: string[] = [];
  for (const entry of entries.filter((name) => name !== generatedDirectory)) {
    const relative = path.posix.join(directory, entry);
    const stats = await lstat(path.join(repo, relative));
    removed.push(...(stats.isDirectory() ? await listFiles(repo, relative) : [relative]));
    await rm(path.join(repo, relative), { recursive: true, force: true });
  }
  return removed.sort();
}

function cleanMessage(directory: string, removed: readonly string[]): Message {
  return removed.length === 0
    ? { level: "info", text: `--clean: ${directory}/ has no files outside ${generatedDirectory}/ to remove.` }
    : {
        level: "info",
        text: `--clean removed ${String(removed.length)} ${removed.length === 1 ? "file" : "files"} from ${directory}/, keeping ${generatedDirectory}/: ${removed.join(", ")}.`,
      };
}

/**
 * Builds the run's HTML report (`fazon report`'s), so every end has one; returns its path from
 * the repository root, or undefined with a warning when it can't be built.
 */
async function runReport(
  setup: AgentCommandSetup,
  done: AgentRunDone,
  context: Context,
  messages: Message[],
): Promise<string | undefined> {
  const storybookUrl = context.environment.env[storybookUrlVariable] ?? "";
  const valid = storybookUrl !== "" && storybookStoryUrl(storybookUrl, "x--y", "light") !== undefined;
  try {
    const built = await buildReport({
      root: setup.repo,
      config: setup.config,
      record: done.outcome.record,
      ...(valid ? { storybookUrl } : {}),
    });
    return built.path;
  } catch (error) {
    messages.push({
      level: "warning",
      text: `The run's report couldn't be built: ${(error as Error).message}`,
      hint: `fazon report ${done.id}`,
    });
    return undefined;
  }
}

/** What's left after the run: the blocking findings of a run that needs a person, and where the report is. */
function endMessages(setup: AgentCommandSetup, done: AgentRunDone, report: string | undefined): Message[] {
  const { record, findings } = done.outcome;
  const messages: Message[] = [];
  const name = setup.spec.spec.name;
  const hint = `fazon report ${setup.component}`;
  if (record.status === "needs-a-person" && findings.length > 0) {
    const rules = [...new Set(findings.map((finding) => `${finding.check}/${finding.rule}`))];
    messages.push({
      level: "error",
      text: `${name}: ${String(record.totals.iterations)} of ${String(record.config.caps.iterations)} iterations used; ${String(findings.length)} blocking ${findings.length === 1 ? "finding remains" : "findings remain"} (${rules.join(", ")}).`,
      hint,
    });
  }
  if (report !== undefined) {
    messages.push(
      record.status === "passed"
        ? { level: "info", text: `Review the result in its report, ${report}; then accept it (decision 2).`, hint }
        : { level: "info", text: `The run's report is ${report}.`, hint },
    );
  }
  return messages;
}

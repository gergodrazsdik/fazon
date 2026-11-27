// SPDX-License-Identifier: GPL-3.0-or-later
import {
  claudeCodeCommand,
  claudeCodeProblem,
  claudeCodeStatus,
  ClaudeCodeVersionError,
  configFileName,
  judgeCredential,
  minimumClaudeCodeVersion,
  type Finding,
} from "@fazon/core";
import { findRuntime, hasImage } from "../container.js";
import type { Environment } from "../environment.js";
import type { Message, Outcome, Status } from "../outcome.js";
import { configMessages, describeFinding, loadRepositoryConfig, type Context } from "./context.js";

export const minimumNodeMajor = 26;

export type CheckState = "ok" | "missing" | "outdated" | "invalid" | "not-checked";

/** One thing `fazon doctor` checks, in its result. */
export interface DoctorCheck {
  readonly check: "node" | "container-runtime" | "claude-code" | "api-key" | "verifier-image" | "config";
  readonly state: CheckState;
  /** Whether the commands can't work without it: then doctor exits 3. */
  readonly required: boolean;
  readonly detail: string;
  /** How to fix it. */
  readonly hint?: string;
  readonly findings?: readonly Finding[];
}

const runtimes = ["docker", "podman"] as const;

/** `fazon doctor`: checks the environment and the config (docs/spec/cli.md#fazon-doctor). */
export async function doctor(context: Context): Promise<Outcome> {
  const { environment } = context;
  const load = await loadRepositoryConfig(context);
  const checks: DoctorCheck[] = [
    checkNode(environment),
    await checkContainerRuntime(environment),
    await checkClaudeCode(environment),
    checkApiKey(environment),
    await checkVerifierImage(environment, load.ok ? load.config.image : undefined),
  ];
  if (load.ok) {
    const overrides = load.overrides.length === 0 ? "" : `, with local overrides of ${load.overrides.join(", ")}`;
    checks.push({ check: "config", state: "ok", required: false, detail: `${configFileName} is valid${overrides}` });
  } else if (load.missing) {
    checks.push({
      check: "config",
      state: "missing",
      required: false,
      detail: `${configFileName}: not found in this directory`,
      hint: "Run fazon doctor from the repository root, or set the repository up with 'fazon init'.",
    });
  } else {
    checks.push({
      check: "config",
      state: "invalid",
      required: false,
      detail: `${configFileName}: ${String(load.findings.length)} ${load.findings.length === 1 ? "finding" : "findings"}`,
      findings: load.findings,
    });
  }

  const missingRequired = checks.filter((check) => check.required && check.state !== "ok");
  const status: Status =
    missingRequired.length > 0
      ? "error"
      : !load.ok && load.localInCi
        ? "refused"
        : !load.ok && !load.missing
          ? "failed"
          : "ok";

  const messages: Message[] = [];
  for (const check of checks) {
    if (
      check.state === "ok" ||
      check.state === "not-checked" ||
      (check.state === "invalid" && check.check === "config")
    ) {
      continue;
    }
    messages.push({
      level: check.required ? "error" : "warning",
      text: `${check.detail}.${check.hint === undefined ? "" : ` ${check.hint}`}`,
    });
  }
  if (!load.ok && !load.missing) {
    messages.push(...configMessages(load));
  }
  messages.push(summary(status, missingRequired));

  return {
    status,
    messages,
    result: { checks },
    text: checks.flatMap((check) => [
      { stream: "stdout" as const, text: `  ${check.state.padEnd(11)} ${check.detail}` },
      ...(context.global.verbose
        ? (check.findings ?? []).map((finding) => ({
            stream: "stdout" as const,
            text: `              ${describeFinding(finding, true)}`,
          }))
        : []),
    ]),
  };
}

function summary(status: Status, missingRequired: readonly DoctorCheck[]): Message {
  switch (status) {
    case "error":
      return {
        level: "error",
        text: `Fazon can't run here: ${missingRequired.map((check) => check.check).join(", ")} must be fixed first.`,
      };
    case "refused":
      return { level: "error", text: "CI refuses to run while fazon.local.yaml exists." };
    case "failed":
      return { level: "error", text: `The environment is ready, but ${configFileName} isn't valid.` };
    default:
      return { level: "info", text: "The environment is ready." };
  }
}

function checkNode(environment: Environment): DoctorCheck {
  const major = Number(environment.nodeVersion.split(".")[0]);
  const detail = `Node.js ${environment.nodeVersion}`;
  if (major >= minimumNodeMajor) {
    return { check: "node", state: "ok", required: true, detail };
  }
  return {
    check: "node",
    state: "outdated",
    required: true,
    detail: `${detail}: Fazon needs Node.js ${String(minimumNodeMajor)} or later`,
    hint: "Install it from https://nodejs.org/en/download, or with a version manager such as fnm.",
  };
}

async function checkContainerRuntime(environment: Environment): Promise<DoctorCheck> {
  const chosen = environment.env.FAZON_CONTAINER_RUNTIME;
  if (chosen !== undefined && chosen !== "") {
    if (!(runtimes as readonly string[]).includes(chosen)) {
      return {
        check: "container-runtime",
        state: "invalid",
        required: true,
        detail: `container runtime: FAZON_CONTAINER_RUNTIME is '${chosen}', which is neither docker nor podman`,
        hint: "Set FAZON_CONTAINER_RUNTIME to docker or podman, or unset it to detect one.",
      };
    }
    const version = await versionOf(environment, chosen);
    return version === undefined
      ? {
          check: "container-runtime",
          state: "missing",
          required: true,
          detail: `container runtime: FAZON_CONTAINER_RUNTIME names ${chosen}, but '${chosen} --version' doesn't run`,
          hint: `Install ${chosen}, or set FAZON_CONTAINER_RUNTIME to the runtime you have.`,
        }
      : { check: "container-runtime", state: "ok", required: true, detail: `${version} (FAZON_CONTAINER_RUNTIME)` };
  }
  // Docker first, as docs/spec/cli.md#environment says.
  for (const runtime of runtimes) {
    const version = await versionOf(environment, runtime);
    if (version !== undefined) {
      return { check: "container-runtime", state: "ok", required: true, detail: `${version} (detected)` };
    }
  }
  return {
    check: "container-runtime",
    state: "missing",
    required: true,
    detail: "container runtime: neither docker nor podman runs",
    hint: "Install Docker (https://docs.docker.com/get-docker/) or Podman (https://podman.io/docs/installation).",
  };
}

/**
 * Claude Code, against the minimum this framework version declares (ADR 0021, ADR 0023). Only a
 * warning when it's missing or older: CI's verify job doesn't run the agent, while propose,
 * generate and feedback refuse to start.
 */
async function checkClaudeCode(environment: Environment): Promise<DoctorCheck> {
  const status = claudeCodeStatus(await versionOf(environment, claudeCodeCommand));
  switch (status.state) {
    case "ok":
      return {
        check: "claude-code",
        state: "ok",
        required: false,
        detail: `Claude Code ${status.version} (${minimumClaudeCodeVersion} or later needed)`,
      };
    case "missing":
      return {
        check: "claude-code",
        state: "missing",
        required: false,
        detail: `Claude Code: not found; propose, generate and feedback need ${minimumClaudeCodeVersion} or later`,
        hint: new ClaudeCodeVersionError(status).hint,
      };
    case "outdated":
      return {
        check: "claude-code",
        state: "outdated",
        required: false,
        detail: `${claudeCodeProblem(status)}; propose, generate and feedback refuse to start with it`,
        hint: new ClaudeCodeVersionError(status).hint,
      };
    case "unreadable":
      return {
        check: "claude-code",
        state: "invalid",
        required: false,
        detail: `${claudeCodeProblem(status)}; propose, generate and feedback refuse to start with it`,
        hint: new ClaudeCodeVersionError(status).hint,
      };
  }
}

/**
 * Whether the verifier image the config pins is on this machine (`<runtime> image inspect`). Only
 * a warning when it isn't: `verify`, `generate` and `feedback` pull it on their first run, and
 * doctor never pulls. Not checked without a valid config to read the pin from, or without a
 * container runtime to look with.
 */
async function checkVerifierImage(environment: Environment, image: string | undefined): Promise<DoctorCheck> {
  if (image === undefined) {
    return {
      check: "verifier-image",
      state: "not-checked",
      required: false,
      detail: `the verifier image: not checked, without a valid ${configFileName} to read its pin from`,
    };
  }
  const runtime = await findRuntime(environment);
  if ("problem" in runtime) {
    return {
      check: "verifier-image",
      state: "not-checked",
      required: false,
      detail: `the verifier image ${image}: not checked, without a container runtime to look for it with`,
    };
  }
  if (await hasImage(environment, runtime.runtime, image)) {
    return {
      check: "verifier-image",
      state: "ok",
      required: false,
      detail: `the verifier image ${image} is on this machine`,
    };
  }
  return {
    check: "verifier-image",
    state: "missing",
    required: false,
    detail: `the verifier image ${image} isn't on this machine yet; the first fazon verify, generate or feedback pulls it`,
    hint: `To pull it now, run '${runtime.runtime} pull --platform linux/amd64 ${image}'.`,
  };
}

function checkApiKey(environment: Environment): DoctorCheck {
  // Never a value, nor any part of one (CLI-003).
  const credential = judgeCredential(environment.env);
  if (credential?.kind === "api-key") {
    return { check: "api-key", state: "ok", required: false, detail: "ANTHROPIC_API_KEY is set" };
  }
  if (credential?.kind === "federation") {
    return {
      check: "api-key",
      state: "ok",
      required: false,
      detail: "the workload identity federation variables are set; the judge uses them",
    };
  }
  return {
    check: "api-key",
    state: "missing",
    required: false,
    detail:
      "ANTHROPIC_API_KEY is not set, nor are the workload identity federation variables; the judge needs one of them, and measure and calibrate the key",
    hint: "Local generation can use your Claude Code login instead.",
  };
}

/** The first line `<program> --version` prints, or `undefined` when it doesn't run. */
async function versionOf(environment: Environment, program: string): Promise<string | undefined> {
  const result = await environment.exec(program, ["--version"]);
  if (result?.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.trim().split("\n")[0]?.trim() ?? program;
}

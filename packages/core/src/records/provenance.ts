// SPDX-License-Identifier: GPL-3.0-or-later
// A component's provenance file (docs/spec/records.md#provenance):
// `<components>/<name>/generated/provenance.json`, valid against
// docs/spec/schemas/provenance.schema.json (RECORD-004). Only the harness writes it: `fazon approve`
// the API part, `fazon accept` the generation part.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { kebabCase } from "../spec/names.js";
import { validateWithSchema } from "../validation/validate.js";
import { recordDate, writeJsonAtomically } from "./json-file.js";
import { roundUsd, type RunRecord, type RunStatus } from "./run-record.js";

/** The provenance file's name in a component's `generated/` directory. */
export const provenanceFile = "provenance.json";

/** One run behind the accepted code. */
export interface ProvenanceRun {
  readonly id: string;
  readonly kind: "generate" | "feedback";
  readonly status: Extract<RunStatus, "passed" | "needs-a-person" | "stopped">;
  readonly iterations: number;
  /** The models its calls used, in the order they were first used. */
  readonly models: readonly string[];
  readonly costUsd: number;
}

/** The runs that produced the current code. */
export interface ProvenanceGeneration {
  readonly framework: string;
  /** The date the result was accepted, `YYYY-MM-DD` (UTC). */
  readonly accepted: string;
  /** The accepted run and the runs it is linked to, oldest first. */
  readonly runs: readonly ProvenanceRun[];
  /** How many hand edits the runs recorded. */
  readonly handEdits: number;
  readonly costUsd: number;
  readonly costEstimated?: boolean;
}

/** The provenance file: the component's latest accepted state. */
export interface Provenance {
  readonly fazon: 0;
  readonly component: string;
  /** The spec's path from the repository root, and its hash. */
  readonly spec: { readonly path: string; readonly hash: string };
  /** The approved API's hash and the date it was approved, `YYYY-MM-DD` (UTC). */
  readonly api: { readonly hash: string; readonly approved: string };
  /** Absent until the first accepted run. */
  readonly generation?: ProvenanceGeneration;
}

/** The provenance file's path from the repository root, such as `src/components/radio-group/generated/provenance.json`. */
export function provenancePath(componentsDirectory: string, component: string): string {
  return path.posix.join(componentsDirectory, kebabCase(component), "generated", provenanceFile);
}

/** The schema's problems with a provenance file; none when it's valid. */
export function provenanceProblems(provenance: unknown): string[] {
  return validateWithSchema("provenance", provenance).map((p) => `${p.path}: ${p.message}`);
}

export type ProvenanceRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly problems: readonly string[] }
  | { readonly kind: "ok"; readonly provenance: Provenance };

/** Reads a provenance file (`file` is absolute, or relative to the working directory) and validates it. */
export async function readProvenance(file: string): Promise<ProvenanceRead> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", problems: [`not JSON: ${(error as Error).message}`] };
  }
  const problems = provenanceProblems(data);
  return problems.length > 0 ? { kind: "invalid", problems } : { kind: "ok", provenance: data as Provenance };
}

/**
 * Writes a provenance file atomically, after validating it.
 * @throws Error when it isn't valid against its schema: a harness bug, never written
 */
export async function writeProvenance(file: string, provenance: Provenance): Promise<void> {
  const problems = provenanceProblems(provenance);
  if (problems.length > 0) {
    throw new Error(`The provenance of ${provenance.component} isn't valid: ${problems.join("; ")}`);
  }
  await writeJsonAtomically(path.dirname(file), path.basename(file), provenance);
}

export interface Approval {
  readonly component: string;
  /** The spec's path from the repository root. */
  readonly specPath: string;
  readonly specHash: string;
  /** The API's hash (`hashApi`). */
  readonly apiHash: string;
  readonly date: Date;
}

/**
 * The provenance after `fazon approve`: the spec and the approved API's hash with today's date.
 * An existing `generation` stays until the next `fazon accept` replaces it.
 */
export function approveApi(previous: Provenance | undefined, approval: Approval): Provenance {
  return {
    fazon: 0,
    component: approval.component,
    spec: { path: approval.specPath, hash: approval.specHash },
    api: { hash: approval.apiHash, approved: recordDate(approval.date) },
    ...(previous?.generation === undefined ? {} : { generation: previous.generation }),
  };
}

/** Whether the spec's API is the approved one: `fazon generate` refuses to run otherwise. */
export function apiApproved(provenance: Provenance | undefined, apiHash: string): boolean {
  return provenance?.api.hash === apiHash;
}

export interface Acceptance {
  readonly framework: string;
  readonly date: Date;
  /** The accepted run and the runs linked to it, oldest first (`linkedRuns`). */
  readonly runs: readonly RunRecord[];
  /** The spec's hash the accepted run started from; the spec's path stays. */
  readonly specHash: string;
}

/**
 * The provenance after `fazon accept`: the `generation` part, from the accepted run's record and
 * the runs linked to it, and the spec's hash it was generated from.
 * @throws Error when a run isn't a finished generate or feedback run with at least one iteration
 */
export function acceptGeneration(provenance: Provenance, acceptance: Acceptance): Provenance {
  if (acceptance.runs.length === 0) throw new Error("Accepting a result needs at least its run.");
  const runs = acceptance.runs.map((record): ProvenanceRun => {
    if (record.kind !== "generate" && record.kind !== "feedback") {
      throw new Error(`The run ${record.id} is a ${record.kind} run, not a generate or feedback run.`);
    }
    if (record.status !== "passed" && record.status !== "needs-a-person" && record.status !== "stopped") {
      throw new Error(`The run ${record.id} hasn't ended: its status is ${record.status}.`);
    }
    if (record.iterations.length === 0) throw new Error(`The run ${record.id} made no agent call.`);
    return {
      id: record.id,
      kind: record.kind,
      status: record.status,
      iterations: record.iterations.length,
      models: [...new Set(record.iterations.map((iteration) => iteration.call.model))],
      costUsd: record.totals.costUsd,
    };
  });
  const costUsd = roundUsd(runs.reduce((sum, run) => sum + run.costUsd, 0));
  return {
    ...provenance,
    spec: { ...provenance.spec, hash: acceptance.specHash },
    generation: {
      framework: acceptance.framework,
      accepted: recordDate(acceptance.date),
      runs,
      handEdits: acceptance.runs.reduce((sum, record) => sum + record.handEdits.length, 0),
      costUsd,
      costEstimated: acceptance.runs.some((record) => record.totals.costEstimated === true),
    },
  };
}

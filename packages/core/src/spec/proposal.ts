// SPDX-License-Identifier: GPL-3.0-or-later
// A proposed API (`fazon propose`, docs/spec/cli.md#fazon-propose): the JSON Schema the agent's
// answer follows, reading the answer from the call, and writing it into the spec's API fields with
// the rest of the file as it was, so the developer reviews the proposal as a diff.
import { Document, isMap, isScalar, LineCounter, parseDocument, visit, type YAMLSeq } from "yaml";
import type { JsonSchema } from "../adapter.js";
import { canonicalJson } from "../records/hash.js";
import { readSchema } from "../validation/schemas.js";
import type { Part, Spec } from "./types.js";

/** The spec fields an API is made of (docs/spec/spec-format.md#approval), in the order the format lists them. */
export const apiFields = ["props", "events", "slots", "methods", "forward", "form", "parts", "extensions"] as const;
export type ApiField = (typeof apiFields)[number];

/** A part's fields that aren't API: the proposal keeps the spec's own. */
const partFieldsOutsideApi = ["states", "produce", "a11y"] as const;

/** The proposed API: the spec's API fields, each optional. */
export type ProposedApi = Partial<Pick<Spec, ApiField>>;

/** The order of the top-level fields in docs/spec/spec-format.md#top-level-fields, where a new field goes. */
const fieldOrder: readonly string[] = [
  "fazon",
  "name",
  "tier",
  "summary",
  "reference",
  "uses",
  ...apiFields.slice(0, -1),
  "states",
  "produce",
  "a11y",
  "fixtures",
  "matrix",
  "tokens",
  "exemptions",
  "judge",
  "extensions",
];

/**
 * The JSON Schema of a proposed API, from the spec schema: an object with only the API fields,
 * whose parts have no `states`, `produce` or `a11y`. Given to the call as `--json-schema`.
 */
export function proposalSchema(): JsonSchema {
  const spec = readSchema("spec");
  const properties = spec.properties as Record<string, unknown>;
  const defs = spec.$defs as Record<string, Record<string, unknown>>;
  const part = defs.part ?? {};
  const partProperties = Object.fromEntries(
    Object.entries(part.properties as Record<string, unknown>).filter(
      ([key]) => !(partFieldsOutsideApi as readonly string[]).includes(key),
    ),
  );
  return {
    $schema: spec.$schema,
    title: "A proposed component API",
    description:
      "The API fields of a Fazon component spec (docs/spec/spec-format.md#the-neutral-api), in the spec's long form.",
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(apiFields.map((field) => [field, properties[field]])),
    $defs: { ...defs, part: { ...part, properties: partProperties } },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON in a final message: the whole message, else its last fenced block, else from its first `{` to its last `}`. */
function jsonInMessage(text: string): unknown {
  const candidates = [text.trim()];
  const lines = text.split("\n");
  const fences = lines.flatMap((line, index) => (line.trimStart().startsWith("```") ? [index] : []));
  for (let i = fences.length - 2; i >= 0; i -= 2) {
    const [open, close] = [fences[i] ?? 0, fences[i + 1] ?? 0];
    candidates.push(lines.slice(open + 1, close).join("\n"));
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // the next one
    }
  }
  return undefined;
}

/**
 * The proposed API from a propose call's answer: its structured output, or the JSON object in its
 * final message. Returns why it can't be read: no JSON object, or fields that aren't API fields.
 * The API itself is checked once it's in the spec (`applyProposal`, then `spec check`).
 */
export function readProposal(answer: {
  readonly structuredOutput?: unknown;
  readonly finalText?: string;
}): { readonly api: ProposedApi } | { readonly problem: string } {
  const value =
    answer.structuredOutput ?? (answer.finalText === undefined ? undefined : jsonInMessage(answer.finalText));
  if (!isObject(value)) {
    return { problem: "the agent's answer has no API: no JSON object in its structured output or final message" };
  }
  const others = Object.keys(value).filter((key) => !(apiFields as readonly string[]).includes(key));
  if (others.length > 0) {
    return {
      problem: `the agent's answer has fields that aren't API fields: ${others.join(", ")}; only ${apiFields.join(", ")} are`,
    };
  }
  return { api: value };
}

/** The proposed parts, each with the spec's own `states`, `produce` and `a11y` for a part it already has. */
function mergeParts(proposed: Spec["parts"], current: Spec["parts"]): Spec["parts"] {
  if (proposed === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(proposed).map(([name, part]): [string, Part] => {
      const api = Object.fromEntries(
        Object.entries(part).filter(([key]) => !(partFieldsOutsideApi as readonly string[]).includes(key)),
      ) as unknown as Part;
      const own = current?.[name];
      const kept = Object.fromEntries(
        partFieldsOutsideApi.flatMap((key) => (own?.[key] === undefined ? [] : [[key, own[key]]])),
      );
      return [name, { ...api, ...kept }];
    }),
  );
}

/** A top-level field's lines in the front matter: `[start, end)`, without the comments and blank lines before the next field. */
interface FieldLines {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

const isCommentOrBlank = (line: string) => line.trim() === "" || line.trimStart().startsWith("#");

/** The top-level fields of a block-mapping front matter, by line; `undefined` when it isn't one. */
function fieldLines(front: string): FieldLines[] | undefined {
  const lineCounter = new LineCounter();
  const document = parseDocument(front, { lineCounter, uniqueKeys: true, logLevel: "silent" });
  if (document.errors.length > 0 || !isMap(document.contents) || document.contents.flow === true) return undefined;
  const lines = front.split("\n");
  const starts: { key: string; start: number }[] = [];
  for (const pair of document.contents.items) {
    if (!isScalar(pair.key)) return undefined;
    const position = lineCounter.linePos(pair.key.range[0]);
    if (position.col !== 1) return undefined;
    starts.push({ key: String(pair.key.value), start: position.line - 1 });
  }
  return starts.map(({ key, start }, index) => {
    let end = starts[index + 1]?.start ?? lines.length;
    while (end > start + 1 && isCommentOrBlank(lines[end - 1] ?? "")) end--;
    return { key, start, end };
  });
}

/** The widest line a list of scalars is written on in flow style; a wider one stays in block style. */
const flowListWidth = 80;

/** Whether a list holds only one-line strings, numbers and booleans: the lists written in flow style. */
function isScalarList(list: YAMLSeq): boolean {
  return list.items.every(
    (item) =>
      isScalar(item) &&
      (typeof item.value === "number" ||
        typeof item.value === "boolean" ||
        (typeof item.value === "string" && !item.value.includes("\n"))),
  );
}

/** A document's lists, in the order `visit` meets them. */
function lists(document: Document): YAMLSeq[] {
  const found: YAMLSeq[] = [];
  visit(document, {
    Seq(_, node) {
      found.push(node);
    },
  });
  return found;
}

/**
 * One field as YAML lines, the way the hand-written specs write it: a list of scalars in flow style
 * (`values: [sm, md]`) when its line fits in `flowListWidth` columns, any other list and every
 * mapping in block style, and no folding.
 */
function fieldText(key: string, value: unknown): string[] {
  const document = new Document({ [key]: value });
  for (const list of lists(document)) list.flow = isScalarList(list);
  const write = () => document.toString({ lineWidth: 0, flowCollectionPadding: false });
  const text = write();
  // A flow list is written on one line: the lists that came out too wide go back to block style.
  // Both documents hold the same lists, so `visit` meets them in the same order.
  const lineCounter = new LineCounter();
  const lines = text.split("\n");
  const written = lists(parseDocument(text, { lineCounter }));
  const original = lists(document);
  const tooWide = written.flatMap((list, index) => {
    if (list.flow !== true || list.range == null) return [];
    const line = lines[lineCounter.linePos(list.range[0]).line - 1] ?? "";
    const own = original[index];
    return line.length > flowListWidth && own !== undefined ? [own] : [];
  });
  for (const list of tooWide) list.flow = false;
  return (tooWide.length > 0 ? write() : text).trimEnd().split("\n");
}

export interface AppliedProposal {
  /** The spec's new text. */
  readonly text: string;
  /** The API fields added, changed or removed, in the order the format lists them. */
  readonly changed: readonly ApiField[];
}

/**
 * The proposed extensions, with the spec's own blocks for the adapters other than `adapter`: the
 * agent proposes for the adapter in use, and the blocks for other frameworks stay as they were.
 */
function mergeExtensions(
  proposed: Spec["extensions"],
  current: Spec["extensions"],
  adapter: string,
): Spec["extensions"] {
  const kept = Object.entries(current ?? {}).filter(([id]) => id !== adapter && proposed?.[id] === undefined);
  const merged = { ...Object.fromEntries(kept), ...proposed };
  return Object.keys(merged).length === 0 ? undefined : merged;
}

/**
 * Writes a proposed API into a spec's text: each API field the proposal has replaces the spec's (a
 * new field goes where the format orders it), an API field it doesn't have is removed, a part
 * keeps its `states`, `produce` and `a11y`, and `extensions` keeps the blocks of adapters other
 * than `adapter`. Every other line of the file stays as it was.
 * @param spec the spec the text holds now, as `parseSpecFile` read it
 * @param adapter the ID of the adapter in use, whose `extensions` block the proposal replaces
 * @throws Error when the text's front matter isn't a block mapping between `---` lines
 */
export function applyProposal(text: string, spec: Spec, api: ProposedApi, adapter: string): AppliedProposal {
  const lines = text.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (lines[0]?.trimEnd() !== "---" || end === -1) throw new Error("The spec has no front matter between '---' lines.");
  const front = lines.slice(1, end);
  const fields = fieldLines(front.join("\n"));
  if (fields === undefined)
    throw new Error("The spec's front matter isn't a block mapping that can be edited by field.");

  const next: Record<string, unknown> = {
    ...api,
    parts: mergeParts(api.parts, spec.parts),
    extensions: mergeExtensions(api.extensions, spec.extensions, adapter),
  };
  const changed = apiFields.filter(
    (field) =>
      canonicalJson(next[field] ?? null) !== canonicalJson((spec as unknown as Record<string, unknown>)[field] ?? null),
  );

  // Edit from the bottom up, so the line numbers above stay right.
  interface Edit {
    at: number;
    remove: number;
    insert: string[];
    order: number;
  }
  const edits: Edit[] = [];
  const order = (key: string) => {
    const index = fieldOrder.indexOf(key);
    return index === -1 ? fieldOrder.length : index;
  };
  for (const field of changed) {
    const value = next[field];
    const existing = fields.find((line) => line.key === field);
    if (existing !== undefined) {
      edits.push({
        at: existing.start,
        remove: existing.end - existing.start,
        insert: value === undefined ? [] : fieldText(field, value),
        order: order(field),
      });
      continue;
    }
    // A new field goes after the last field the format orders before it, or first.
    const before = fields.filter((line) => order(line.key) < order(field)).at(-1);
    edits.push({ at: before?.end ?? 0, remove: 0, insert: fieldText(field, value), order: order(field) });
  }
  edits.sort((a, b) => b.at - a.at || b.order - a.order);
  for (const edit of edits) front.splice(edit.at, edit.remove, ...edit.insert);

  return { text: [lines[0], ...front, ...lines.slice(end)].join("\n"), changed };
}

// SPDX-License-Identifier: GPL-3.0-or-later
import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import ajvFormats from "ajv-formats";
import { readSchema, type SchemaName } from "./schemas.js";

/** One step into a JSON value: an object key or an array index. */
export type PathSegment = string | number;

/** Where a value breaks a schema, and how. */
export interface SchemaFinding {
  /** A JSON path such as `$.props.tone` or `$.exemptions[0]`, as check-jsonschema writes it. */
  readonly path: string;
  /** The same path as keys and indices. */
  readonly segments: readonly PathSegment[];
  /** The key the finding is about, when it's reported at the object that holds the key. */
  readonly key?: string;
  readonly message: string;
}

/** `$`, then `.key` for each key and `[n]` for each index. Keys are written as they are, dots and all. */
export function jsonPath(segments: readonly PathSegment[]): string {
  return (
    "$" + segments.map((segment) => (typeof segment === "number" ? `[${String(segment)}]` : `.${segment}`)).join("")
  );
}

let ajv: Ajv2020 | undefined;
const validators = new Map<SchemaName, ValidateFunction>();

function validator(name: SchemaName): ValidateFunction {
  let validate = validators.get(name);
  if (validate === undefined) {
    ajv ??= createAjv();
    validate = ajv.compile(readSchema(name));
    validators.set(name, validate);
  }
  return validate;
}

function createAjv(): Ajv2020 {
  const instance = new Ajv2020({
    allErrors: true,
    // The schema and parent schema on each error, for messages that quote a schema's description.
    verbose: true,
    // The schemas are plain JSON Schema 2020-12, checked by check-jsonschema too. Ajv's extra
    // strictness about `required` and `type` next to `if`/`then` goes beyond the standard.
    strictSchema: true,
    strictNumbers: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
  });
  // A CommonJS module: its default export arrives as the module object under Node's ESM loader.
  ajvFormats.default(instance);
  return instance;
}

/** Validates data against one of the Fazon schemas; no findings means it's valid. */
export function validateWithSchema(name: SchemaName, data: unknown): readonly SchemaFinding[] {
  const validate = validator(name);
  if (validate(data)) {
    return [];
  }
  return findingsFromErrors(validate.errors ?? [], data);
}

/** A schema finding in a named file. */
export type FileSchemaFinding = SchemaFinding & { readonly file: string };

/**
 * Validates the parsed data of one file against a schema; each finding names the file. Its shape,
 * `(schema, data, file)`, fits validation hooks such as the tokens pipeline's, which map a rule on.
 */
export function validateFile(schema: SchemaName, data: unknown, file: string): readonly FileSchemaFinding[] {
  return validateWithSchema(schema, data).map((finding) => ({ ...finding, file }));
}

function findingsFromErrors(errors: readonly ErrorObject[], data: unknown): SchemaFinding[] {
  // A failed oneOf or anyOf reports every branch's errors too; only the alternative as a whole is
  // useful to a person, so errors at or below it are dropped. Ajv reports a branch's errors before
  // the alternative's own, so a nested alternative gives way to the one around it. The schemas use
  // oneOf alone at its level, so no sibling keyword's errors are lost.
  const kept = errors.filter(
    (error, index) =>
      !errors.some(
        (other, otherIndex) =>
          otherIndex > index &&
          (other.keyword === "oneOf" || other.keyword === "anyOf") &&
          within(error.instancePath, other.instancePath),
      ),
  );
  // A value of the wrong type fails other keywords at the same place too; the type is the point.
  const typeErrors = new Set(kept.filter((error) => error.keyword === "type").map((error) => error.instancePath));

  const findings: SchemaFinding[] = [];
  const seen = new Set<string>();
  for (const error of kept) {
    // An `if` error only says that its `then` or `else` failed, and that error is reported itself.
    // A `propertyNames` error repeats the nested error, which carries the key.
    if (error.keyword === "if" || error.keyword === "propertyNames") {
      continue;
    }
    if (error.keyword !== "type" && typeErrors.has(error.instancePath)) {
      continue;
    }
    const finding = toFinding(error, data);
    const key = `${finding.path}\n${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  }
  return findings;
}

function within(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + "/");
}

function toFinding(error: ErrorObject, data: unknown): SchemaFinding {
  const segments = segmentsOf(error.instancePath, data);
  // A `false` schema under `properties` forbids a key: report it at the object, naming the key,
  // as for an unknown key.
  if (error.keyword === "false schema" && typeof segments.at(-1) === "string") {
    const key = segments.at(-1) as string;
    const parent = segments.slice(0, -1);
    return { path: jsonPath(parent), segments: parent, key, message: `key '${key}' is not allowed here` };
  }
  const path = jsonPath(segments);
  const message = describe(error);
  if (error.propertyName !== undefined) {
    return { path, segments, key: error.propertyName, message: `key '${error.propertyName}': ${message}` };
  }
  const key = unknownKey(error);
  return key === undefined ? { path, segments, message } : { path, segments, key, message };
}

/** Turns a JSON Pointer into keys and indices, using the data to tell an index from a key. */
function segmentsOf(pointer: string, data: unknown): PathSegment[] {
  if (pointer === "") {
    return [];
  }
  const segments: PathSegment[] = [];
  let value: unknown = data;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(value)) {
      const index = Number(key);
      segments.push(index);
      value = value[index];
    } else {
      segments.push(key);
      value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
    }
  }
  return segments;
}

function unknownKey(error: ErrorObject): string | undefined {
  const params = error.params as Record<string, unknown>;
  const key = params.additionalProperty ?? params.unevaluatedProperty;
  return typeof key === "string" ? key : undefined;
}

function describe(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  const description = schemaDescription(error.parentSchema);
  switch (error.keyword) {
    case "required":
      return `missing required key '${String(params.missingProperty)}'`;
    case "dependentRequired":
      return `key '${String(params.missingProperty)}' is required when '${String(params.property)}' is set`;
    case "additionalProperties":
      return `unknown key '${String(params.additionalProperty)}'`;
    case "unevaluatedProperties":
      return `unknown key '${String(params.unevaluatedProperty)}'`;
    case "type":
      return `must be ${listOf(String(params.type).split(","), "or", article)}`;
    case "const":
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case "enum":
      return `must be one of: ${(params.allowedValues as unknown[]).map(String).join(", ")}`;
    case "pattern":
      return `${JSON.stringify(error.data)} doesn't match ${String(params.pattern)}${description === undefined ? "" : ` (${description})`}`;
    case "minLength":
    case "minItems":
    case "minProperties":
      return params.limit === 1 ? "must not be empty" : (error.message ?? "is too short");
    case "uniqueItems":
      return `has duplicate items (${String(params.j)} and ${String(params.i)})`;
    case "not":
      return describeNot(error.schema);
    case "oneOf":
    case "anyOf":
      return Array.isArray(params.passingSchemas)
        ? "matches more than one allowed form"
        : `doesn't match any allowed form${description === undefined ? "" : `: ${description}`}`;
    default:
      return (error.message ?? "is not valid").replaceAll("NOT", "not");
  }
}

function describeNot(schema: unknown): string {
  const required = (schema as { required?: unknown } | undefined)?.required;
  if (Array.isArray(required)) {
    return `must not have ${listOf(
      required.map((key) => `'${String(key)}'`),
      "and",
    )} here`;
  }
  return "must not match the form it has";
}

function schemaDescription(schema: unknown): string | undefined {
  const description = (schema as { description?: unknown } | undefined)?.description;
  return typeof description === "string" ? description.replace(/\.$/, "") : undefined;
}

function article(type: string): string {
  return type === "object" || type === "array" || type === "integer" ? `an ${type}` : `a ${type}`;
}

function listOf(items: readonly string[], conjunction: string, map: (item: string) => string = (item) => item): string {
  const mapped = items.map(map);
  return mapped.length <= 1
    ? mapped.join("")
    : `${mapped.slice(0, -1).join(", ")} ${conjunction} ${mapped.at(-1) ?? ""}`;
}

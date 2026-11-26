// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue adapter's API reader (docs/spec/adapter-boundary.md#contract-tests, ADAPTER-004): reads
// a component's single-file components with vue-component-meta and gives their actual API in
// api.json's form, so the contract test `contract-api` compares like with like.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createChecker } from "vue-component-meta";
import { typeExpression, type VueComponentApi, type VueType } from "./api.js";

/** A type the API mapping can't express, such as an object; it never equals an approved type. */
export interface UnsupportedType {
  readonly type: "unsupported";
  /** The TypeScript type, as the compiler prints it. */
  readonly typescript: string;
}

/** A type as the reader finds it: one api.json can hold, or one it can't. */
export type ReadType = VueType | UnsupportedType;

/** A prop as the component declares it. */
export type ReadProp = ReadType & {
  readonly required: boolean;
  /** The default, when the component declares one; an `{ expression }` when it isn't a JSON value. */
  readonly default?: unknown;
};

/** An exposed member: a method, or a member that isn't one. */
export type ReadExposed =
  | { readonly params: Readonly<Record<string, ReadType>>; readonly returns?: ReadType }
  | { readonly property: ReadType };

/** One single-file component's actual API, in api.json's form (`VueComponentApi`). */
export interface ReadComponentApi {
  readonly file: string;
  /** The name it declares with `defineOptions({ name })`; absent when it declares none. */
  readonly name?: string;
  readonly props: Readonly<Record<string, ReadProp>>;
  readonly events: Readonly<Record<string, { readonly payload?: ReadType }>>;
  readonly slots: Readonly<
    Record<string, { readonly required: boolean; readonly props: Readonly<Record<string, ReadType>> }>
  >;
  readonly exposed: Readonly<Record<string, ReadExposed>>;
}

/** api.json's `components`: each single-file component's API, keyed by its component name. */
export type ApprovedComponents = Readonly<Record<string, VueComponentApi>>;

export interface VueApiReaderOptions {
  /** The TypeScript configuration that includes the components, such as the repository's `tsconfig.json`. */
  readonly tsconfig: string;
}

/** Reads components' APIs with one vue-component-meta checker, which keeps its program between reads. */
export interface VueApiReader {
  /** Reads one single-file component, by its path. */
  readFile(file: string): ReadComponentApi;
  /**
   * Reads each single-file component api.json names, from the component's directory, keyed as in
   * api.json. A file that doesn't exist is left out. An enum's values take the approved order, as a
   * union of literals has none in TypeScript; values the approved enum lacks follow, sorted.
   */
  readComponent(directory: string, approved: ApprovedComponents): Record<string, ReadComponentApi>;
}

/** Creates a reader for the components a TypeScript configuration includes. */
export function createVueApiReader(options: VueApiReaderOptions): VueApiReader {
  const checker = createChecker(path.resolve(options.tsconfig));
  const known = new Map<string, string>();
  /** Gives the checker the current text of each file, so a long-running reader sees edits. */
  const refresh = (file: string) => {
    const text = readFileSync(file, "utf8");
    if (known.get(file) !== text) {
      checker.updateFile(file, text);
      known.set(file, text);
    }
  };

  const readFile = (file: string): ReadComponentApi => {
    const absolute = path.resolve(file);
    refresh(absolute);
    const meta = checker.getComponentMeta(absolute);
    const program = checker.getProgram();
    if (program === undefined) throw new Error(`vue-component-meta has no program for ${absolute}.`);
    const types = program.getTypeChecker();
    const read = (type: ts.Type) => readType(type, types);

    const props: Record<string, ReadProp> = {};
    for (const prop of meta.props) {
      if (prop.global) continue;
      props[prop.name] = {
        ...read(prop.getTypeObject()),
        required: prop.required,
        ...(prop.default === undefined ? {} : { default: parseDefault(prop.default) }),
      };
    }
    const events: Record<string, { payload?: ReadType }> = {};
    for (const event of meta.events) {
      const payload = eventPayload(event.getTypeObject(), types);
      events[event.name] = payload === undefined ? {} : { payload };
    }
    const slots: Record<string, { required: boolean; props: Record<string, ReadType> }> = {};
    for (const slot of meta.slots) {
      slots[slot.name] = {
        required: slotRequired(slot.getDeclarations()),
        props: slotProps(slot.getTypeObject(), types),
      };
    }
    const exposed: Record<string, ReadExposed> = {};
    for (const member of meta.exposed) {
      exposed[member.name] = readExposed(member.getTypeObject(), types);
    }
    const name = definedName(program.getSourceFile(absolute)) ?? meta.name;
    return { file: path.basename(absolute), ...(name === undefined ? {} : { name }), props, events, slots, exposed };
  };

  return {
    readFile,
    readComponent(directory, approved) {
      // Helpers the components import may have changed too.
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && /\.(vue|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          refresh(path.resolve(directory, entry.name));
        }
      }
      const result: Record<string, ReadComponentApi> = {};
      for (const [name, api] of Object.entries(approved)) {
        const file = path.join(directory, api.file);
        if (existsSync(file)) result[name] = alignEnums(readFile(file), api);
      }
      return result;
    },
  };
}

/**
 * The name `defineOptions({ name })` declares in `<script setup>`, which vue-component-meta doesn't
 * read: from the component's code in the checker's program, where the macro is a top-level call.
 * A name that isn't a string literal is its source text. Undefined when there's no such call.
 */
function definedName(source: ts.SourceFile | undefined): string | undefined {
  for (const statement of source?.statements ?? []) {
    if (!ts.isExpressionStatement(statement)) continue;
    const call = statement.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "defineOptions") {
      continue;
    }
    const [options] = call.arguments;
    if (options === undefined || !ts.isObjectLiteralExpression(options)) continue;
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      if (!(ts.isIdentifier(key) || ts.isStringLiteral(key)) || key.text !== "name") continue;
      const value = property.initializer;
      return ts.isStringLiteralLike(value) ? value.text : value.getText(source);
    }
  }
  return undefined;
}

/** The type with `undefined`, `null` and `void` taken out: an optional prop's or parameter's own type. */
function definedMembers(type: ts.Type): ts.Type[] {
  const members = type.isUnion() ? type.types : [type];
  return members.filter((t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) === 0);
}

function readType(type: ts.Type, types: ts.TypeChecker): ReadType {
  const unsupported: UnsupportedType = { type: "unsupported", typescript: types.typeToString(type) };
  const members = definedMembers(type);
  const [only] = members;
  if (only === undefined) return unsupported;
  if (members.length === 2 && members.every((t) => (t.flags & ts.TypeFlags.BooleanLiteral) !== 0)) {
    return { type: "boolean" };
  }
  if (members.every((t) => t.isStringLiteral())) {
    return { type: "enum", values: members.map((t) => t.value) };
  }
  if (members.length > 1) return unsupported;
  if ((only.flags & ts.TypeFlags.String) !== 0) return { type: "string" };
  if ((only.flags & ts.TypeFlags.Number) !== 0) return { type: "number" };
  if (types.isArrayType(only)) {
    const [item] = types.getTypeArguments(only as ts.TypeReference);
    const items = item === undefined ? undefined : readType(item, types);
    if (items !== undefined && items.type !== "unsupported" && items.type !== "array") return { type: "array", items };
  }
  return unsupported;
}

/** An event's payload: its one argument; none without arguments. */
function eventPayload(type: ts.Type | undefined, types: ts.TypeChecker): ReadType | undefined {
  if (type === undefined) return undefined;
  if (!types.isTupleType(type)) return readType(type, types);
  const elements = types.getTypeArguments(type as ts.TypeReference);
  const [first] = elements;
  if (first === undefined) return undefined;
  return elements.length === 1 ? readType(first, types) : { type: "unsupported", typescript: types.typeToString(type) };
}

/** A scoped slot's props, from the type of its slot function's parameter. */
function slotProps(type: ts.Type, types: ts.TypeChecker): Record<string, ReadType> {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return {};
  return Object.fromEntries(
    types
      .getPropertiesOfType(type)
      .map((property) => [property.name, readType(types.getTypeOfSymbol(property), types)]),
  );
}

/**
 * Whether `defineSlots` declares the slot without `?`. vue-component-meta drops the optional flag,
 * so this reads the declaration: its name, then `?` for an optional slot. A slot only the template
 * declares has no declaration in the script and is optional.
 */
function slotRequired(declarations: readonly { file: string; range: [number, number] }[]): boolean {
  const [declaration] = declarations;
  if (declaration === undefined || !existsSync(declaration.file)) return false;
  const text = readFileSync(declaration.file, "utf8").slice(declaration.range[0], declaration.range[1]);
  let index = 0;
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    index = text.indexOf(quote, 1) + 1;
    if (index === 0) return false;
  } else {
    while (index < text.length && /[\w$]/.test(text[index] ?? "")) index++;
    if (index === 0) return false;
  }
  while (text[index] === " ") index++;
  return text[index] !== "?";
}

function readExposed(type: ts.Type, types: ts.TypeChecker): ReadExposed {
  const [signature] = type.getCallSignatures();
  if (signature === undefined) return { property: readType(type, types) };
  const params = Object.fromEntries(
    signature.getParameters().map((parameter) => [parameter.name, readType(types.getTypeOfSymbol(parameter), types)]),
  );
  const result = signature.getReturnType();
  return definedMembers(result).length === 0 ? { params } : { params, returns: readType(result, types) };
}

/** A default as vue-component-meta prints it, as a JSON value; `{ expression }` when it isn't one. */
export function parseDefault(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const quoted = /^'([^'\\]*)'$/.exec(text);
    return quoted === null ? { expression: text } : quoted[1];
  }
}

/** Puts each enum's values in the approved order, then the others, sorted. */
function alignEnums(actual: ReadComponentApi, approved: VueComponentApi): ReadComponentApi {
  const align = <T extends ReadType>(type: T, expected: VueType | undefined): T => {
    if (expected === undefined) return type;
    if (type.type === "enum" && expected.type === "enum") {
      const values = type.values;
      return {
        ...type,
        values: [
          ...expected.values.filter((value) => values.includes(value)),
          ...values.filter((value) => !expected.values.includes(value)).sort(),
        ],
      };
    }
    if (type.type === "array" && expected.type === "array") {
      return { ...type, items: align(type.items, expected.items) };
    }
    return type;
  };
  const record = <T extends ReadType>(
    types: Readonly<Record<string, T>>,
    expected: Readonly<Record<string, VueType>> | undefined,
  ): Record<string, T> =>
    Object.fromEntries(Object.entries(types).map(([key, type]) => [key, align(type, expected?.[key])]));
  return {
    ...actual,
    props: record(actual.props, approved.props),
    events: Object.fromEntries(
      Object.entries(actual.events).map(([name, event]) => {
        const payload = approved.events[name]?.payload;
        return [name, event.payload === undefined ? event : { payload: align(event.payload, payload) }];
      }),
    ),
    slots: Object.fromEntries(
      Object.entries(actual.slots).map(([name, slot]) => [
        name,
        { ...slot, props: record(slot.props, approved.slots[name]?.props) },
      ]),
    ),
    exposed: Object.fromEntries(
      Object.entries(actual.exposed).map(([name, member]) => {
        const expected = approved.exposed[name];
        if ("property" in member || expected === undefined) return [name, member];
        return [
          name,
          {
            params: record(member.params, expected.params),
            ...(member.returns === undefined ? {} : { returns: align(member.returns, expected.returns) }),
          },
        ];
      }),
    ),
  };
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** How a type reads in a message: its TypeScript expression. */
function typeText(type: ReadType): string {
  return type.type === "unsupported" ? type.typescript : typeExpression(type);
}

function sameType(a: ReadType, b: ReadType): boolean {
  if (a.type === "enum" && b.type === "enum") return sameValues(a.values, b.values);
  if (a.type === "array" && b.type === "array") return sameType(a.items, b.items);
  if (a.type === "unsupported" || b.type === "unsupported") return false;
  return a.type === b.type;
}

const show = (value: unknown) => (value === undefined ? "none" : JSON.stringify(value));

/**
 * The differences between the approved API and the actual one, one sentence each, in api.json's
 * order: what `contract-api` reports. Empty when they match.
 */
export function apiDifferences(
  approved: ApprovedComponents,
  actual: Readonly<Record<string, ReadComponentApi>>,
): string[] {
  const differences: string[] = [];
  for (const [name, expected] of Object.entries(approved)) {
    const found = actual[name];
    if (found === undefined) {
      differences.push(`${name}: ${expected.file} is missing.`);
      continue;
    }
    const say = (text: string) => differences.push(`${name}: ${text}`);
    if (found.name === undefined) {
      say(
        `the component declares no name; the approved API says ${show(expected.name)}, as defineOptions({ name: ${show(expected.name)} }).`,
      );
    } else if (found.name !== expected.name) {
      say(`the component's name is ${show(found.name)}; the approved API says ${show(expected.name)}.`);
    }
    const compareTypes = (what: string, want: ReadType, got: ReadType) => {
      if (!sameType(want, got)) say(`${what} has the type ${typeText(got)}; the approved API says ${typeText(want)}.`);
    };
    const members = <W, G>(
      kind: string,
      want: Readonly<Record<string, W>>,
      got: Readonly<Record<string, G>>,
      compare: (what: string, w: W, g: G) => void,
    ) => {
      for (const [member, w] of Object.entries(want)) {
        const g = got[member];
        if (g === undefined) say(`the ${kind} ${member} is missing.`);
        else compare(`the ${kind} ${member}`, w, g);
      }
      for (const member of Object.keys(got)) {
        if (!(member in want)) say(`the ${kind} ${member} isn't in the approved API.`);
      }
    };
    const typeRecord = (
      what: string,
      want: Readonly<Record<string, VueType>>,
      got: Readonly<Record<string, ReadType>>,
    ) => {
      members(what, want, got, (member, w, g) => {
        compareTypes(member, w, g);
      });
    };

    members("prop", expected.props, found.props, (what, want, got) => {
      compareTypes(what, want, got);
      if (want.required !== got.required) {
        say(
          `${what} is ${got.required ? "required" : "optional"}; the approved API says ${want.required ? "required" : "optional"}.`,
        );
      }
      if (JSON.stringify(want.default) !== JSON.stringify(got.default)) {
        say(`${what} has the default ${show(got.default)}; the approved API says ${show(want.default)}.`);
      }
    });
    members("event", expected.events, found.events, (what, want, got) => {
      if (want.payload === undefined && got.payload !== undefined)
        say(`${what} has a payload of ${typeText(got.payload)}; the approved API says none.`);
      else if (want.payload !== undefined && got.payload === undefined)
        say(`${what} has no payload; the approved API says ${typeText(want.payload)}.`);
      else if (want.payload !== undefined && got.payload !== undefined)
        compareTypes(`${what}'s payload`, want.payload, got.payload);
    });
    members("slot", expected.slots, found.slots, (what, want, got) => {
      if (want.required !== got.required) {
        say(
          `${what} is ${got.required ? "required" : "optional"}; the approved API says ${want.required ? "required" : "optional"}.`,
        );
      }
      typeRecord(`${what.slice(4)}'s prop`, want.props, got.props);
    });
    members("method", expected.exposed, found.exposed, (what, want, got) => {
      if ("property" in got) {
        say(`${what} is exposed as a ${typeText(got.property)}, not a method.`);
        return;
      }
      typeRecord(`${what.slice(4)}'s parameter`, want.params, got.params);
      if (want.returns === undefined && got.returns !== undefined)
        say(`${what} returns ${typeText(got.returns)}; the approved API says nothing.`);
      else if (want.returns !== undefined && got.returns === undefined)
        say(`${what} returns nothing; the approved API says ${typeText(want.returns)}.`);
      else if (want.returns !== undefined && got.returns !== undefined)
        compareTypes(`${what}'s result`, want.returns, got.returns);
    });
  }
  return differences;
}

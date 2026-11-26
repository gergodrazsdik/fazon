// SPDX-License-Identifier: GPL-3.0-or-later
// The token rules of the `lint` check (docs/spec/check-catalogue.md#lint) over a stylesheet: every
// token-bound property takes a role token's custom property, a component-local custom property
// whose own value is valid, or an allowed value.
import type { Container, Declaration } from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
import type { TokenCatalog } from "./catalog.js";
import { isAllowedValue, isUnitlessNumber, tokenBoundProperty, type TokenBoundProperty } from "./properties.js";

/** The token rules' IDs, as the check catalogue names them. */
export type TokenLintRule = "raw-value" | "raw-token" | "unknown-token";

/** A broken token rule in one declaration. */
export interface TokenProblem {
  readonly rule: TokenLintRule;
  readonly declaration: Declaration;
  /** Where in the declaration's text (`declaration.toString()`) the offending value starts and ends. */
  readonly index: number;
  readonly endIndex: number;
  readonly message: string;
}

const mathFunctions = new Set(["calc", "min", "max", "clamp", "-webkit-calc"]);
const localPrefix = "--_";
const operators = new Set(["+", "-", "*", "/"]);

interface Context {
  /** The property the value is used for, such as `padding`. */
  readonly property: string;
  readonly spec: TokenBoundProperty;
  /** The declaration the value is in: the property's own, or a local custom property's. */
  readonly declaration: Declaration;
  /** Where the value starts in `declaration.toString()`. */
  readonly offset: number;
  /** The local custom properties followed to get here, to stop at a cycle. */
  readonly chain: readonly string[];
}

/**
 * Checks every token-bound declaration under `container`, a stylesheet or a document of several
 * (the `<style>` blocks of a single-file component). Local custom properties (`--_name`) are looked
 * up in the whole container; a problem in a local's value is reported at the local's declaration,
 * once per property it is used for.
 */
export function analyzeTokens(container: Container, catalog: TokenCatalog): TokenProblem[] {
  const locals = new Map<string, Declaration[]>();
  container.walkDecls((declaration) => {
    if (!declaration.prop.startsWith(localPrefix)) return;
    const list = locals.get(declaration.prop) ?? [];
    list.push(declaration);
    locals.set(declaration.prop, list);
  });

  const problems: TokenProblem[] = [];
  const seen = new Set<string>();
  const declarationIds = new Map<Declaration, number>();
  const visitedLocals = new Set<string>();
  const idOf = (declaration: Declaration): number => {
    let id = declarationIds.get(declaration);
    if (id === undefined) {
      id = declarationIds.size;
      declarationIds.set(declaration, id);
    }
    return id;
  };
  const report = (context: Context, node: ValueNode, rule: TokenLintRule, message: string) => {
    const index = context.offset + node.sourceIndex;
    const key = `${String(idOf(context.declaration))}:${String(index)}:${rule}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({
      rule,
      declaration: context.declaration,
      index,
      endIndex: context.offset + node.sourceEndIndex,
      message,
    });
  };

  const where = (context: Context): string =>
    context.declaration.prop === context.property
      ? `\`${context.property}\``
      : `\`${context.declaration.prop}\`, which \`${context.property}\` uses,`;

  const checkVar = (node: valueParser.FunctionNode, context: Context): void => {
    const [first, ...rest] = node.nodes;
    const name = first?.type === "word" ? first.value : "";
    const fallback = rest.slice(rest.findIndex((n) => n.type === "div" && n.value === ",") + 1);
    if (rest.length > 0) checkNodes(fallback, context);
    if (!name.startsWith("--")) {
      report(
        context,
        node,
        "unknown-token",
        `\`${valueParser.stringify(node)}\` in ${where(context)} names no custom property.`,
      );
      return;
    }
    if (name.startsWith(localPrefix)) {
      checkLocal(name, node, context);
      return;
    }
    const token = catalog.token(name);
    if (token === undefined) {
      report(context, node, "unknown-token", unknownMessage(name, where(context)));
    } else if (token.kind === "raw") {
      report(context, node, "raw-token", rawTokenMessage(name, token.path, where(context)));
    }
  };

  const unknownMessage = (name: string, place: string): string => {
    const withPrefix = catalog.prefix === "" ? undefined : `--${catalog.prefix}-${name.slice(2)}`;
    const prefixed = withPrefix === undefined ? undefined : catalog.token(withPrefix);
    const hint =
      prefixed === undefined
        ? `Use a role token's custom property${catalog.prefix === "" ? "" : ` (they start with \`--${catalog.prefix}-\`)`}, or a component-local property named \`--_<name>\`.`
        : `The token set's custom properties carry the prefix \`${catalog.prefix}\`: did you mean \`var(${withPrefix ?? ""})\`?`;
    return `\`${name}\` in ${place} is neither a token nor a component-local custom property. ${hint}`;
  };

  const rawTokenMessage = (name: string, path: string, place: string): string => {
    const roles = catalog.rolesReferencing(path);
    const hint =
      roles.length > 0
        ? `Use a role token that points at it: ${list(roles.map((r) => `\`var(${r.name})\``))}.`
        : "Use the role token for what the value means; no role token points at this one.";
    return `\`${name}\` in ${place} is the raw token \`${path}\`; components use role tokens only. ${hint}`;
  };

  const rawValueMessage = (node: ValueNode, context: Context): string => {
    const text = valueParser.stringify(node);
    const exact = catalog.rolesWithValue(context.spec.types, text);
    let hint: string;
    if (exact.length > 0) {
      hint = `Use the role token with this value: ${list(exact.map((t) => `\`var(${t.name})\``))}.`;
    } else {
      const roles = catalog.rolesOfType(context.spec.types);
      hint =
        roles.length > 0
          ? `Use the role token that fits, such as ${list(
              roles.slice(0, 4).map((t) => `\`var(${t.name})\``),
              "or",
            )}${roles.length > 4 ? ` (${String(roles.length)} role tokens of type ${context.spec.types.join(" or ")})` : ""}.`
          : "Use a role token.";
    }
    return `\`${text}\` in ${where(context)} is a raw value. ${hint} Allowed without a token: 0, auto, none, normal, inherit, initial, unset, revert, currentColor, transparent and 100%.`;
  };

  const checkLocal = (name: string, node: ValueNode, context: Context): void => {
    const declarations = locals.get(name);
    if (declarations === undefined) {
      report(
        context,
        node,
        "unknown-token",
        `\`${name}\` in ${where(context)} isn't declared in this component. Declare it, set from a role token, or use the role token directly.`,
      );
      return;
    }
    if (context.chain.includes(name)) return;
    for (const declaration of declarations) {
      // Each local declaration is checked once per property that uses it.
      const key = `${String(idOf(declaration))}:${context.property}`;
      if (visitedLocals.has(key)) continue;
      visitedLocals.add(key);
      checkDeclaration(declaration, {
        property: context.property,
        spec: context.spec,
        declaration,
        offset: 0,
        chain: [...context.chain, name],
      });
    }
  };

  const checkMath = (nodes: readonly ValueNode[], context: Context): void => {
    for (const node of nodes) {
      if (node.type === "space" || node.type === "div" || node.type === "comment") continue;
      if (node.type === "function") {
        const name = node.value.toLowerCase();
        if (name === "var") checkVar(node, context);
        else if (name === "" || mathFunctions.has(name)) checkMath(node.nodes, context);
        else report(context, node, "raw-value", rawValueMessage(node, context));
        continue;
      }
      if (node.type !== "word") {
        report(context, node, "raw-value", rawValueMessage(node, context));
        continue;
      }
      // `2px*3`: an operator without spaces stays inside the word.
      for (const operand of splitOperators(node)) {
        if (operators.has(operand.value) || isUnitlessNumber(operand.value) || isAllowedValue(operand.value)) continue;
        report(context, operand, "raw-value", rawValueMessage(operand, context));
      }
    }
  };

  const checkNodes = (nodes: readonly ValueNode[], context: Context): void => {
    const free = context.spec.free;
    for (const node of nodes) {
      if (node.type === "space" || node.type === "div" || node.type === "comment") continue;
      if (node.type === "function") {
        const name = node.value.toLowerCase();
        if (name === "var") checkVar(node, context);
        else if (mathFunctions.has(name)) checkMath(node.nodes, context);
        else if (free?.({ type: "function", value: name }) !== true) {
          report(context, node, "raw-value", rawValueMessage(node, context));
        }
        continue;
      }
      if (node.type === "word" && isAllowedValue(node.value)) continue;
      if (node.type === "word" || node.type === "string") {
        if (free?.({ type: node.type, value: node.value.toLowerCase() }) === true) continue;
      }
      report(context, node, "raw-value", rawValueMessage(node, context));
    }
  };

  const checkDeclaration = (declaration: Declaration, context: Context): void => {
    const text = declaration.raws.value?.raw ?? declaration.value;
    const offset = declaration.prop.length + (declaration.raws.between ?? ":").length;
    checkNodes(valueParser(text).nodes, { ...context, offset });
  };

  container.walkDecls((declaration) => {
    if (declaration.prop.startsWith("--")) return;
    if (
      declaration.parent?.type === "atrule" &&
      /^font-face$/i.test((declaration.parent as { name?: string }).name ?? "")
    ) {
      return;
    }
    const spec = tokenBoundProperty(declaration.prop);
    if (spec === undefined) return;
    checkDeclaration(declaration, {
      property: declaration.prop.toLowerCase(),
      spec,
      declaration,
      offset: 0,
      chain: [],
    });
  });
  return problems;
}

/** A word split at `*` and `/`, keeping each part's position. */
function splitOperators(node: valueParser.WordNode): valueParser.WordNode[] {
  const parts: valueParser.WordNode[] = [];
  let start = 0;
  const push = (from: number, to: number) => {
    if (to > from) {
      parts.push({
        type: "word",
        value: node.value.slice(from, to),
        sourceIndex: node.sourceIndex + from,
        sourceEndIndex: node.sourceIndex + to,
      });
    }
  };
  for (let i = 0; i < node.value.length; i++) {
    const char = node.value[i];
    if (char === "*" || char === "/") {
      push(start, i);
      push(i, i + 1);
      start = i + 1;
    }
  }
  push(start, node.value.length);
  return parts;
}

function list(items: readonly string[], last = "or"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1) ?? ""}`;
}

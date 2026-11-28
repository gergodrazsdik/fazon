// SPDX-License-Identifier: GPL-3.0-or-later
// The `tokens` check (docs/spec/check-catalogue.md#tokens): for each element of the component and
// each token-bound property, the declaration that wins the cascade, followed to the token it names.
import type { PropValue, PropValues, TokenRule, When } from "../spec/types.js";
import type { IndexedToken, TokenIndex } from "../tokens/build.js";
import { winningDeclarations, type Declaration } from "./cascade.js";
import { looksLikeTokenValue, parseValue, type ValueComponent } from "./css-values.js";
import type { ElementStyles, InspectedElement, TextFonts } from "./snapshot.js";
import { physicalProperty, tokenBoundProperties, tokenShorthands } from "./token-properties.js";
import { locate, type CheckContext, type CheckFinding } from "./types.js";

/** The `tokens` check's rules. */
export type TokensRule = "raw-value" | "raw-token" | "unknown-token" | "user-agent" | "token-rule" | "font-fallback";

/** For an element, the role token each physical longhand must resolve to (from the spec's token rules). */
export type ExpectedTokens = (element: InspectedElement) => ReadonlyMap<string, string> | undefined;

export interface TokensCheckInput {
  /** The component's elements, inspected with styles. */
  readonly elements: readonly InspectedElement[];
  readonly index: TokenIndex;
  /** The theme the story rendered in; the token set's default theme when absent. */
  readonly theme?: string;
  /** The token rules that apply to each element in this story: `tokenRuleExpectations`. */
  readonly expected?: ExpectedTokens;
  readonly context?: CheckContext;
}

// The inherited token-bound properties, and the role token the frame's base styles give them
// (docs/spec/tokens.md#base-styles).
const inherited = new Set([
  "color",
  "caret-color",
  "accent-color",
  "fill",
  "stroke",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
]);
const baseStyles: ReadonlyMap<string, string> = new Map([
  ["color", "color.text.primary"],
  ["font-family", "font-family.body"],
  ["font-size", "font-size.body"],
  ["font-weight", "font-weight.body"],
  ["line-height", "line-height.body"],
]);

interface Problem {
  readonly rule: Exclude<TokensRule, "user-agent" | "token-rule" | "font-fallback">;
  readonly actual: string;
  readonly message: string;
}

interface Evaluation {
  readonly problems: Problem[];
  /** The tokens the value reaches, through component-local custom properties. */
  readonly tokens: IndexedToken[];
}

/** Runs the `tokens` check on one rendered story. */
export function checkTokens(input: TokensCheckInput): CheckFinding[] {
  const theme = input.theme ?? input.index.defaultTheme;
  const tokens = input.index.byTheme.get(theme);
  if (tokens === undefined) throw new Error(`The token index has no theme ${theme}.`);
  const findings: CheckFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: CheckFinding) => {
    const key = [finding.selector, finding.rule, finding.expected, finding.actual, finding.message].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  const winnersOf = input.elements.map((element) =>
    element.styles === undefined ? undefined : winningDeclarations(element.styles.matched),
  );
  // Evaluates a value declared on the element at `at`, for following inherited values.
  const evaluateAt = (value: string, whole: boolean, at: number): Evaluation => {
    const own = winnersOf[at];
    const styles = input.elements[at]?.styles;
    if (own === undefined || styles === undefined) return { problems: [], tokens: [] };
    return evaluateValue(value, whole, tokens, own, styles.inherited.map(winningDeclarations), 0);
  };
  input.elements.forEach((element, i) => {
    const winners = winnersOf[i];
    if (winners === undefined || element.styles === undefined) {
      throw new Error(`The element ${element.selector} was inspected without its styles.`);
    }
    const where = {
      check: "tokens" as const,
      ...locate(input.context ?? {}),
      ...(element.part === undefined ? {} : { part: element.part }),
      selector: element.selector,
      blocking: true,
    };
    const declarations = (own: ReadonlyMap<string, Declaration>, styles: ElementStyles, selector: string) => {
      const ancestors = styles.inherited.map((sources) => winningDeclarations(sources));
      for (const finding of declarationFindings(own, ancestors, tokens)) add({ ...where, selector, ...finding });
    };
    declarations(winners, element.styles, element.selector);
    // A pseudo-element's own declarations, with its originating element as its nearest ancestor.
    for (const pseudo of element.pseudoElements ?? []) {
      declarations(winningDeclarations(pseudo.styles.matched), pseudo.styles, `${element.selector}${pseudo.pseudo}`);
    }

    const expected = input.expected?.(element);
    for (const [property, token] of expected ?? []) {
      const reached = reachedTokens(property, input.elements, winnersOf, i, evaluateAt);
      if (reached.paths.includes(token)) continue;
      add({
        ...where,
        rule: "token-rule",
        message:
          `${property} must take the token ${token} (a token rule in the spec applies), ` +
          `but ${reached.paths.length > 0 ? `resolves to ${reached.paths.join(", ")}` : reached.describe}.`,
        expected: token,
        actual: reached.paths.length > 0 ? reached.paths.join(", ") : reached.describe,
      });
    }

    // font-fallback: the text of an element whose font family comes from a token renders in the
    // family's first font, not a fallback.
    const fonts = element.fonts;
    if (fonts !== undefined && !fontLoaded(fonts)) {
      const family = reachedTokens("font-family", input.elements, winnersOf, i, evaluateAt);
      if (family.paths.length > 0) {
        const used = fonts.rendered.map((f) => f.family).join(", ");
        const why =
          fonts.faces.length === 0
            ? "no font face in the page declares it, and no installed font has that name"
            : `none of the page's font faces for it has loaded (${[...new Set(fonts.faces)].join(", ")})`;
        add({
          ...where,
          rule: "font-fallback",
          message:
            `font-family (${family.paths.join(", ")}) names ${fonts.first} first, but its text renders in ${used}, a fallback: ` +
            `${why}. Load the font in the library's stylesheet, or name the family its font faces register.`,
          expected: fonts.first,
          actual: used,
        });
      }
    }
  });
  return findings;
}

/**
 * The `raw-value`, `raw-token`, `unknown-token` and `user-agent` findings of the winning
 * declarations of one element or pseudo-element, without their location.
 */
function declarationFindings(
  winners: ReadonlyMap<string, Declaration>,
  ancestors: readonly ReadonlyMap<string, Declaration>[],
  tokens: ReadonlyMap<string, IndexedToken>,
): Pick<CheckFinding, "rule" | "message" | "actual" | "expected">[] {
  const findings: Pick<CheckFinding, "rule" | "message" | "actual" | "expected">[] = [];
  for (const property of tokenBoundProperties.keys()) {
    const declaration = winners.get(property);
    if (declaration === undefined || declaration.implicit) continue;
    const evaluation = evaluateValue(declaration.value, declaration.whole, tokens, winners, ancestors, 0);
    if (declaration.origin === "user-agent") {
      // An empty value is a system font the browser sets with the font shorthand.
      if (declaration.value === "" || evaluation.problems.length > 0) {
        findings.push({
          rule: "user-agent",
          message:
            `${property} takes the browser's own value ${shown(declaration)}: no author declaration sets it. ` +
            "Set it from a role token, or to an allowed value.",
          actual: declaration.value === "" ? `(the browser's ${declaration.declaredAs})` : declaration.value,
        });
      }
      continue;
    }
    for (const problem of evaluation.problems) {
      findings.push({
        rule: problem.rule,
        message: `${declared(declaration)}: ${problem.message}`,
        actual: problem.actual,
        ...(problem.rule === "raw-token" ? { expected: "a role token" } : {}),
      });
    }
  }
  return findings;
}

// The generic font families, which always resolve to a font (docs/spec/check-catalogue.md#tokens).
const genericFamilies = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/**
 * Whether the browser rendered some of the text with the first family's font. A family the page
 * declares with `@font-face` is loaded when one of its faces has loaded and a web font rendered
 * the text; any other family when an installed font of that name rendered it. A generic family
 * always resolves, and text the protocol reports no font for gives no evidence either way.
 */
function fontLoaded(fonts: TextFonts): boolean {
  const first = fonts.first.toLowerCase();
  if (first === "" || genericFamilies.has(first) || fonts.rendered.length === 0) return true;
  if (fonts.faces.length > 0) return fonts.faces.includes("loaded") && fonts.rendered.some((f) => f.custom);
  return fonts.rendered.some((f) => f.family.toLowerCase() === first || f.postScriptName.toLowerCase() === first);
}

function shown(declaration: Declaration): string {
  return declaration.value === "" ? `(a system font, from its ${declaration.declaredAs} shorthand)` : declaration.value;
}

function declared(declaration: Declaration): string {
  if (declaration.whole) return `${declaration.declaredAs}: ${declaration.value}`;
  return declaration.declaredAs === declaration.property
    ? `${declaration.property}: ${declaration.value}`
    : `${declaration.property} (declared as ${declaration.declaredAs})`;
}

/**
 * Follows a value to the tokens it names. Custom properties are tokens when the index knows them,
 * component-local (`--_*`) properties are followed to their own winning declaration on the element
 * or its nearest ancestor, and anything else is unknown. In a shorthand whose components can't be
 * told apart (`whole`), only literals that look like a token's value count as raw.
 */
function evaluateValue(
  value: string,
  whole: boolean,
  tokens: ReadonlyMap<string, IndexedToken>,
  own: ReadonlyMap<string, Declaration>,
  ancestors: readonly ReadonlyMap<string, Declaration>[],
  depth: number,
): Evaluation {
  const problems: Problem[] = [];
  const reached: IndexedToken[] = [];
  const visit = (component: ValueComponent, inMath: boolean): void => {
    switch (component.kind) {
      case "allowed":
        return;
      case "number":
        if (inMath) return;
        if (!whole || looksLikeTokenValue(component.text)) problems.push(raw(component.text));
        return;
      case "literal":
        if (!whole || looksLikeTokenValue(component.text)) problems.push(raw(component.text));
        return;
      case "math":
        for (const operand of component.operands) visit(operand, true);
        return;
      case "var": {
        const token = tokens.get(component.name);
        if (token !== undefined) {
          reached.push(token);
          if (token.kind === "raw") {
            problems.push({
              rule: "raw-token",
              actual: token.path,
              message: `${component.text} is the raw token ${token.path}; components take role tokens.`,
            });
          }
          return;
        }
        if (component.name.startsWith("--_") && depth < 16) {
          const local = own.get(component.name) ?? ancestors.map((a) => a.get(component.name)).find(Boolean);
          if (local !== undefined) {
            const inner = evaluateValue(local.value, false, tokens, own, ancestors, depth + 1);
            reached.push(...inner.tokens);
            problems.push(
              ...inner.problems.map((p) => ({ ...p, message: `${component.name} is ${local.value}: ${p.message}` })),
            );
            return;
          }
          problems.push({
            rule: "unknown-token",
            actual: component.name,
            message: `the component-local property ${component.name} is not set on the element or an ancestor.`,
          });
          return;
        }
        problems.push({
          rule: "unknown-token",
          actual: component.name,
          message: `${component.name} is neither a token nor a component-local property (--_*).`,
        });
        return;
      }
    }
  };
  for (const component of parseValue(value)) visit(component, false);
  return { problems, tokens: reached };
}

function raw(text: string): Problem {
  return {
    rule: "raw-value",
    actual: text,
    message: `${text} is a literal; take the value from a role token, or use an allowed value.`,
  };
}

/**
 * The tokens a property resolves to on an element: its own declaration, or for an inherited
 * property the nearest ancestor in the component that declares it, or the frame's base style.
 */
function reachedTokens(
  property: string,
  elements: readonly InspectedElement[],
  winnersOf: readonly (ReadonlyMap<string, Declaration> | undefined)[],
  start: number,
  evaluate: (value: string, whole: boolean, at: number) => Evaluation,
): { paths: string[]; describe: string } {
  let at: number | undefined = start;
  while (at !== undefined) {
    const declaration = winnersOf[at]?.get(property);
    const inherits =
      declaration !== undefined &&
      (declaration.value === "inherit" || (declaration.value === "unset" && inherited.has(property)));
    if (declaration !== undefined && !declaration.implicit && !inherits) {
      const types = tokenBoundProperties.get(property)?.types ?? [];
      const found = evaluate(declaration.value, declaration.whole, at).tokens;
      const fitting = declaration.whole ? found.filter((t) => types.includes(t.type)) : found;
      return { paths: [...new Set(fitting.map((t) => t.path))], describe: `is ${declaration.value || "not set"}` };
    }
    if (!inherits && !inherited.has(property)) return { paths: [], describe: "is not set" };
    at = elements[at]?.parent;
  }
  const base = baseStyles.get(property);
  return base === undefined
    ? { paths: [], describe: "is not set" }
    : { paths: [base], describe: `inherits ${base} from the frame` };
}

/** The physical longhands a token rule's property stands for: `padding` is its four sides. */
export function tokenRuleLonghands(property: string): string[] {
  const shorthand = tokenShorthands.get(property);
  if (shorthand !== undefined) return [...shorthand.longhands];
  return [physicalProperty(property)];
}

/** Whether a condition holds for an element with these props and states. */
export function conditionHolds(when: When | undefined, props: PropValues, states: readonly string[]): boolean {
  if (when === undefined) return true;
  for (const [name, value] of Object.entries(when.props ?? {})) {
    if (!sameValue(props[name], value)) return false;
  }
  if (when.state !== undefined) {
    return when.state === "default" ? states.length === 0 : states.includes(when.state);
  }
  return true;
}

function sameValue(a: PropValue | undefined, b: PropValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface TokenRuleOptions {
  /** The component's name: the part of rules that name none. */
  readonly component: string;
  /** The props of a part's instance in this story (defaults included); `instance` counts from 0. */
  readonly props: (part: string, instance: number) => PropValues;
}

/**
 * The spec's token rules as expectations per element (docs/spec/spec-format.md#tokens): a rule
 * applies to the root of its part (the component's root when it names none) when its condition
 * holds for that instance's props and states. For each property, the rule with the most specific
 * condition (the most props and state) wins; a later rule wins a tie.
 */
export function tokenRuleExpectations(rules: readonly TokenRule[], options: TokenRuleOptions): ExpectedTokens {
  return (element) => {
    if (!element.partRoot || element.part === undefined) return undefined;
    const props = options.props(element.part, element.instance ?? 0);
    const chosen = new Map<string, { token: string; specificity: number }>();
    for (const rule of rules) {
      if ((rule.part ?? options.component) !== element.part) continue;
      if (!conditionHolds(rule.when, props, element.states)) continue;
      const specificity = Object.keys(rule.when?.props ?? {}).length + (rule.when?.state === undefined ? 0 : 1);
      for (const [property, token] of Object.entries(rule.use)) {
        for (const longhand of tokenRuleLonghands(property)) {
          const current = chosen.get(longhand);
          if (current === undefined || specificity >= current.specificity) chosen.set(longhand, { token, specificity });
        }
      }
    }
    return chosen.size === 0 ? undefined : new Map([...chosen].map(([p, c]) => [p, c.token]));
  };
}

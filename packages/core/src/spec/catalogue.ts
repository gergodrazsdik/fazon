// SPDX-License-Identifier: GPL-3.0-or-later
// The check catalogue's checks and rules as data (docs/spec/check-catalogue.md), for SPEC-012:
// which rules an exemption may name, and which of them can be exempted.
import { createRequire } from "node:module";
import type { TestRule } from "../adapter.js";
import { axeRulesOff, axeTags } from "../checks/a11y.js";
import type { LayoutRule } from "../checks/layout.js";
import type { TokensRule } from "../checks/tokens.js";
import type { CheckId } from "../checks/types.js";
import type { VisualRule } from "../checks/visual.js";

export type CheckKind = "source" | "rendered";

/** One check of the catalogue: its kind, and each rule of its rule sheet with whether it can be exempted. */
export interface CatalogueCheck {
  readonly kind: CheckKind;
  readonly rules: Readonly<Record<string, boolean>>;
}

/** Every rule of a rule type, each with whether it can be exempted. */
type Rules<Rule extends string> = Readonly<Record<Rule, boolean>>;

const layout: Rules<LayoutRule> = { overflow: true, "clipped-text": true, scroll: true, "target-size": true };
const tokens: Rules<TokensRule> = {
  "raw-value": true,
  "raw-token": true,
  "unknown-token": true,
  "user-agent": true,
  "token-rule": true,
};
// None of the visual rules can be exempted.
const visual: Rules<VisualRule> = { changed: false, orphan: false, image: false };
const test: Rules<TestRule | "missing-behaviour"> = {
  "contract-api": true,
  "contract-render": true,
  behaviour: true,
  "missing-behaviour": true,
};

/**
 * The checks, with their rules. `a11y` also takes the ID of every axe rule the check runs
 * (`axeRuleIds`). `lint`'s `eslint` and `stylelint` stand for any rule of ESLint's or Stylelint's own,
 * which can't be exempted.
 */
export const checkCatalogue: Readonly<Record<CheckId, CatalogueCheck>> = Object.freeze({
  build: { kind: "source", rules: { compile: true, types: true, storybook: true, generated: true } },
  lint: {
    kind: "source",
    rules: {
      "raw-value": true,
      "raw-token": true,
      "unknown-token": true,
      "inline-suppression": true,
      eslint: false,
      stylelint: false,
    },
  },
  test: { kind: "source", rules: test },
  package: { kind: "source", rules: { export: true, types: true, styles: true, manifest: true } },
  a11y: { kind: "rendered", rules: { "spec-role": true, "spec-name": true, "spec-aria": true } },
  tokens: { kind: "rendered", rules: tokens },
  layout: { kind: "rendered", rules: layout },
  visual: { kind: "rendered", rules: visual },
});

let axeRules: ReadonlySet<string> | undefined;

/** The IDs of the axe rules the `a11y` check runs: those with its tags, without the rules it turns off. */
export function axeRuleIds(): ReadonlySet<string> {
  if (axeRules === undefined) {
    const axe = createRequire(import.meta.url)("axe-core") as {
      getRules: (tags: string[]) => { ruleId: string }[];
    };
    const off = new Set(axeRulesOff);
    axeRules = new Set(
      axe
        .getRules([...axeTags])
        .map((rule) => rule.ruleId)
        .filter((id) => !off.has(id)),
    );
  }
  return axeRules;
}

/** A rule of a check: undefined when the check has no such rule, else whether it can be exempted. */
export function catalogueRule(check: CheckId, rule: string): boolean | undefined {
  const sheet = checkCatalogue[check];
  if (Object.hasOwn(sheet.rules, rule)) return sheet.rules[rule];
  if (check === "a11y" && axeRuleIds().has(rule)) return true;
  return undefined;
}

export function isCheckId(check: string): check is CheckId {
  return Object.hasOwn(checkCatalogue, check);
}

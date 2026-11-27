// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { TokenSet } from "../tokens/types.js";
import { capsText, promptFence, roleTokens } from "./common.js";
import { proposePrompt, type ProposePromptInput } from "./propose.js";

const specText = "---\nfazon: 0\nname: Badge\n---\n\n## Purpose\n\nA status label.\n";

function promptInput(overrides: Partial<ProposePromptInput> = {}): ProposePromptInput {
  return {
    component: "Badge",
    specFile: "specs/badge.md",
    specText,
    hasApi: false,
    specsDirectory: "specs",
    componentsDirectory: "src/components",
    adapter: { id: "vue", framework: "Vue 3", mapping: "| Neutral | Vue 3 |\n|---|---|\n| prop | `defineProps` |" },
    roleTokens: [{ path: "color.text.primary", type: "color" }],
    conventions: { file: "docs/conventions.md", text: "# Conventions\n\nUse `--_` for local properties.\n" },
    left: { iterations: 1, budgetUsd: 10, runMinutes: 90 },
    callMinutes: 20,
    ...overrides,
  };
}

describe("the propose prompt", () => {
  it("carries the spec, the adapter's mapping, the role tokens, the conventions and the caps", () => {
    const prompt = proposePrompt(promptInput());
    expect(prompt.startsWith("# Propose the API of Badge\n")).toBe(true);
    expect(prompt).toContain(`## The spec: specs/badge.md\n\n\`\`\`markdown\n${specText}\`\`\``);
    expect(prompt).toContain("## The Vue 3 mapping\n\n| Neutral | Vue 3 |");
    expect(prompt).toContain("- `color.text.primary` (color)");
    expect(prompt).toContain("From `docs/conventions.md`:\n\n```markdown\n# Conventions\n");
    expect(prompt).toContain(
      "A propose run makes one call. This is the run's last call. It has $10.00 of its budget and 90 minutes left; this call stops after 20 minutes.",
    );
    expect(prompt).toContain("Don't edit any file and don't run any command");
    expect(prompt).toContain("in the `vue` block; the spec's blocks for other adapters stay as they are");
    expect(prompt).not.toContain("The spec has an API already");
    expect(prompt.endsWith("\n")).toBe(true);
  });

  it("says that parts render in their parent's default slot, which needs no slot declared for them (F-0030)", () => {
    const prompt = proposePrompt(promptInput());
    expect(prompt).toContain("- **Parts render in their parent's default slot,**");
    expect(prompt).toContain(
      "never declare a slot only to say where a component's or a part's parts go: a parent whose only content is its parts has no `default` slot.",
    );
  });

  it("says when the spec has an API, and when there's no mapping, conventions doc or role token", () => {
    const prompt = proposePrompt(
      promptInput({ hasApi: true, adapter: { id: "vue", framework: "Vue 3" }, roleTokens: [] }),
    );
    expect(prompt).toContain("The spec has an API already.");
    expect(prompt).toContain("The vue adapter describes no mapping; write the neutral API.");
    expect(prompt).toContain("The token set has no role tokens.");
    const rest = Object.fromEntries(
      Object.entries(promptInput()).filter(([key]) => key !== "conventions"),
    ) as unknown as ProposePromptInput;
    expect(proposePrompt(rest)).toContain("The repository has no conventions doc.");
  });
});

describe("the prompt helpers", () => {
  it("fence a text with more backticks than it has in a row", () => {
    expect(promptFence("a\n```js\nb\n```\n", "md")).toBe("````md\na\n```js\nb\n```\n````");
    expect(promptFence("plain")).toBe("```\nplain\n```");
  });

  it("list the role tokens once each, sorted, without the raw ones", () => {
    const token = (tokenPath: string, value: unknown, type = "color") => ({
      path: tokenPath,
      type,
      value,
      file: "x.json",
    });
    const tokenSet = {
      files: [
        { tokens: [token("color.blue.600", "#1d4ed8"), token("color.text.primary", "{color.blue.600}")] },
        { tokens: [token("color.action.primary", "{color.blue.600}"), token("color.text.primary", "{color.gray.50}")] },
      ],
    } as unknown as TokenSet;
    expect(roleTokens(tokenSet)).toEqual([
      { path: "color.action.primary", type: "color" },
      { path: "color.text.primary", type: "color" },
    ]);
  });

  it("say the caps left", () => {
    expect(capsText({ iterations: 3, budgetUsd: 4.5, runMinutes: 61.7 }, 20)).toBe(
      "The run has 3 calls left, this one included. It has $4.50 of its budget and 61 minutes left; this call stops after 20 minutes.",
    );
  });
});

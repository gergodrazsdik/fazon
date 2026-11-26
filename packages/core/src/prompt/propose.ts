// SPDX-License-Identifier: GPL-3.0-or-later
// The prompt of a propose run's one call (docs/spec/cli.md#fazon-propose,
// docs/spec/agent-permissions.md#what-the-agent-receives): the spec, the adapter's API mapping, the
// role tokens and the conventions doc, and how to answer. The agent edits nothing: its final answer
// is the API, which the harness writes into the spec.
import { apiFields } from "../spec/proposal.js";
import {
  capsText,
  joinPrompt,
  promptFence,
  promptSection,
  roleTokenList,
  type CapsLeft,
  type RoleToken,
} from "./common.js";

export interface ProposePromptInput {
  /** The component, in PascalCase. */
  readonly component: string;
  /** The spec's path from the repository root. */
  readonly specFile: string;
  /** The spec's text, as it is now. */
  readonly specText: string;
  /** Whether the spec has API fields already: then the proposal replaces them. */
  readonly hasApi: boolean;
  /** The specs directory, from the repository root: the other components' specs. */
  readonly specsDirectory: string;
  /** The components directory, from the repository root: the components built so far. */
  readonly componentsDirectory: string;
  readonly adapter: {
    readonly id: string;
    readonly framework: string;
    /** How the neutral API maps to the framework, as Markdown; the adapter's `apiMappingText`. */
    readonly mapping?: string;
  };
  readonly roleTokens: readonly RoleToken[];
  /** The conventions doc; absent when the repository has none. */
  readonly conventions?: { readonly file: string; readonly text: string };
  readonly left: CapsLeft;
  readonly callMinutes: number;
}

/** How the neutral API is written: the part of docs/spec/spec-format.md the agent needs. */
const apiFormat = `Every member is written in long form, as a mapping, even when it only has a type.

- **Names:** components and parts in PascalCase; props, events, slots, methods and parameters in camelCase; enum values in kebab-case.
- **Types:** \`type\` is \`boolean\`, \`string\`, \`number\`, \`enum\` (with \`values\`, a list of kebab-case values) or \`array\` (with \`items\`, a type other than \`array\`).
- **\`props\`,** keyed by name: a \`type\`, and optionally \`description\`, \`default\` (of the prop's type; an enum's default is one of its values), \`required: true\` for a prop with no default, and \`model: true\` for a two-way bound prop, whose change notification is implied and isn't listed under \`events\`.
- **\`events\`,** keyed by name: \`description\` and an optional \`payload\` type. Name events for what happened (\`click\`, \`dismiss\`), with no \`on\` prefix.
- **\`slots\`,** keyed by name, \`default\` for the unnamed slot: \`description\`, \`required\`, and optional \`data\`, the values the component passes to the slot's content, keyed by name, each with a type.
- **\`methods\`,** keyed by name: \`description\`, optional \`params\` (keyed by name, each with a type) and an optional \`returns\` type. Only for what props can't do, such as moving focus.
- **\`forward\`:** which element receives undeclared attributes, classes and the ref: \`root\` (the default) or a part's name.
- **\`form\`:** for a form field: \`value\` (a \`model\` prop, required), and optionally the props that hold its \`name\`, \`disabled\` and \`required\` flags.
- **\`parts\`,** keyed by PascalCase name, for a multi-part component: \`parent\` (the component or another part), \`count\` (\`one\`, \`optional\` or \`many\`), \`portal: true\` when it renders outside the root, such as overlay content, an optional \`description\`, and its own \`props\`, \`events\`, \`slots\` and \`methods\`. A part with \`count: many\` can't be the parent of another \`many\` part, and no part has the component's name.
- **\`extensions\`,** keyed by adapter ID: only for what one framework needs and the neutral API can't say, with \`reason\`, and \`add\`, \`map\` or \`omit\` keyed by member path (\`props.size\`, \`parts.Trigger.props.asChild\`).
- Within the component, and within each part, a name is used once across props, events and methods.`;

/** An API in the long form, for the shape of the answer. */
const example = `{
  "props": {
    "variant": { "type": "enum", "values": ["primary", "secondary"], "default": "primary", "description": "Visual emphasis." },
    "disabled": { "type": "boolean", "default": false }
  },
  "events": { "click": { "description": "Activation by pointer or keyboard; not emitted while disabled." } },
  "slots": { "default": { "required": true, "description": "The label." } },
  "forward": "root"
}`;

/** The prompt of a propose call. */
export function proposePrompt(input: ProposePromptInput): string {
  const { component, adapter } = input;
  const task = [
    `Draft the API of the component ${component} from its spec, \`${input.specFile}\`, below. The spec is the developer's: its summary, Purpose, Behaviour, Appearance and Never sections say what the component must do and offer. The API you propose is what they review and approve before any code is written.`,
    "",
    "- Propose what the spec calls for: every variant, size, option, state a prop sets, event and piece of content it describes, and nothing it doesn't. Prefer few, plainly named members.",
    "- Stay consistent with the other components: read their specs in " +
      `\`${input.specsDirectory}/\` and the components built so far in \`${input.componentsDirectory}/\`, and use the same names and values for the same things.`,
    `- Write the neutral API, the same for every framework. It is built with the ${adapter.framework} adapter (\`${adapter.id}\`); its mapping is below. Use \`extensions\` only for what this framework needs and the neutral API can't say, in the \`${adapter.id}\` block; the spec's blocks for other adapters stay as they are.`,
    "- Don't write `states`, `produce`, `a11y`, `fixtures`, `matrix`, `tokens`, `exemptions` or `judge`: they build on the approved API and come later.",
    ...(input.hasApi
      ? ["- The spec has an API already. Keep what fits the spec, and change what doesn't: your answer replaces it."]
      : []),
    "- Don't edit any file and don't run any command: you can only read. The harness writes your answer into the spec, and the developer reviews it as a diff.",
  ].join("\n");

  const answer = [
    `Answer with the API as one JSON object, and nothing else: its keys are the API fields you use, out of ${apiFields.map((field) => `\`${field}\``).join(", ")}. When you were given a JSON Schema for your answer, follow it. The harness checks the result as \`fazon spec check\` does; an answer it can't read or that the check rejects ends the run without changing the spec.`,
    "",
    "For example, for a simple button:",
    "",
    promptFence(example, "json"),
  ].join("\n");

  return joinPrompt([
    `# Propose the API of ${component}`,
    promptSection("Your task", task),
    promptSection("The API format", apiFormat),
    promptSection("Your answer", answer),
    promptSection(`The spec: ${input.specFile}`, promptFence(input.specText, "markdown")),
    promptSection(
      `The ${adapter.framework} mapping`,
      adapter.mapping ?? `The ${adapter.id} adapter describes no mapping; write the neutral API.`,
    ),
    promptSection(
      "The role tokens",
      `The tokens components style themselves with, for reference:\n\n${roleTokenList(input.roleTokens)}`,
    ),
    promptSection(
      "The conventions",
      input.conventions === undefined
        ? "The repository has no conventions doc."
        : `From \`${input.conventions.file}\`:\n\n${promptFence(input.conventions.text, "markdown")}`,
    ),
    promptSection("Caps", `A propose run makes one call. ${capsText(input.left, input.callMinutes)}`),
  ]);
}

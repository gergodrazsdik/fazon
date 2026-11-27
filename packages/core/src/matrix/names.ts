// SPDX-License-Identifier: GPL-3.0-or-later
// Story names (docs/spec/story-matrix.md#names) and the IDs Storybook derives for them.
import { kebabCase } from "../spec/names.js";
import type { StoryState } from "./types.js";

/** An axis as a name segment's key: `variant` is `variant`, `Content.size` is `content-size`. */
export function axisSegmentKey(axis: string): string {
  return axis.split(".").map(kebabCase).join("-");
}

/** The state as the name's last segment: `hover`, or `<part>-<state>` for a part's state. */
export function stateSegment(state: StoryState): string {
  return state.part === undefined ? state.name : `${kebabCase(state.part)}-${state.name}`;
}

/**
 * A story's name: `<component>--<fixture>--<axis>-<value>--…--<state>`, with every axis in the
 * order given. Values are written as in the spec; booleans as `true` and `false`.
 */
export function storyName(
  component: string,
  fixture: string,
  axes: Readonly<Record<string, boolean | string | number>>,
  state: StoryState,
): string {
  const segments = [
    kebabCase(component),
    fixture,
    ...Object.entries(axes).map(([axis, value]) => `${axisSegmentKey(axis)}-${String(value)}`),
    stateSegment(state),
  ];
  return segments.join("--");
}

/**
 * The story's export name in its story file: the name without `<component>--`, in PascalCase
 * (docs/spec/adapter-boundary.md, "One export per manifest story").
 */
export function storyExportName(component: string, name: string): string {
  const prefix = `${kebabCase(component)}--`;
  const rest = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return rest
    .split("-")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** The ID Storybook gives the story: the component's name is the stories' title. */
export function storybookId(component: string, name: string): string {
  return storybookToId(component, storybookStoryNameFromExport(storyExportName(component, name)));
}

// The three functions below follow Storybook's CSF tooling (`sanitize`, `toId` and
// `storyNameFromExport` with its start-case transform), which derives a story's ID from the
// title and the export name. The manifest must record the ID Storybook derives, so they must
// keep giving the same result as the Storybook version the adapters pin.

/** Storybook's `sanitize`: lower case, every separator a hyphen, no repeated or outer hyphens. */
export function storybookSanitize(text: string): string {
  // Repeated hyphens are collapsed first, so at most one is left at either end to remove.
  return text
    .toLowerCase()
    .replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

/** Storybook's `toId`: `<sanitized title>--<sanitized story name>`. */
export function storybookToId(title: string, storyName: string): string {
  const kind = storybookSanitize(title);
  const story = storybookSanitize(storyName);
  if (kind === "" || story === "") {
    throw new Error(`'${title}' and '${storyName}' must each include letters or digits to give a Storybook ID`);
  }
  return `${kind}--${story}`;
}

/** Storybook's `storyNameFromExport`: `LabelSize2xl` reads `Label Size 2 Xl`. */
export function storybookStoryNameFromExport(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\./g, " ")
    .replace(/([^\n])([A-Z])([a-z])/g, (_, a: string, b: string, c: string) => `${a} ${b}${c}`)
    .replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b}`)
    .replace(/([a-z])([0-9])/gi, (_, a: string, b: string) => `${a} ${b}`)
    .replace(/([0-9])([a-z])/gi, (_, a: string, b: string) => `${a} ${b}`)
    .replace(/(\s|^)(\w)/g, (_, a: string, b: string) => `${a}${b.toUpperCase()}`)
    .replace(/ +/g, " ")
    .trim();
}

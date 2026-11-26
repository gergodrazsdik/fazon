// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isKebabCase, kebabCase, type Tier } from "@fazon/core";
import { refused, type Outcome } from "../outcome.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

export const tiers: readonly Tier[] = ["primitive", "form-control", "composite"];
const defaultTier: Tier = "primitive";

const licenseLine = "SPDX-License-Identifier: MIT-0\n";
const placeholder = /\{\{([a-z]+)\}\}/g;

/**
 * The spec scaffold: the MIT-0 template text of `templates/spec.md.tmpl` with the component's name
 * and tier filled in (docs/spec/licensing.md). The template's license line isn't written out
 * (LICENSE-002).
 */
export function specScaffold(name: string, tier: Tier): string {
  const text = readFileSync(new URL("../../templates/spec.md.tmpl", import.meta.url), "utf8");
  if (!text.startsWith(licenseLine)) {
    throw new Error(`The spec template must start with the line '${licenseLine.trimEnd()}'.`);
  }
  const values: Readonly<Record<string, string>> = { name, tier };
  return text.slice(licenseLine.length).replace(placeholder, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`The spec template has no value for {{${key}}}.`);
    return value;
  });
}

/** The PascalCase component name of a kebab-case one: `radio-group` is `RadioGroup`. */
export function pascalCase(component: string): string {
  return component
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** `fazon spec new <component> [--tier …]` (docs/spec/cli.md#fazon-spec-new). */
export async function specNew(invocation: Invocation, context: Context): Promise<Outcome> {
  const [component] = invocation.positionals;
  if (component === undefined) {
    return refused(
      "fazon spec new needs the component's name, in kebab-case, as its spec file is named.",
      "fazon spec new button",
    );
  }
  if (!isKebabCase(component)) {
    const suggestion = kebabCase(component.replace(/[^A-Za-z0-9]+/g, "-")).replace(/-+/g, "-");
    return refused(
      `'${component}' isn't a component name. Name components in kebab-case, as their spec files are named: ${suggestion}.`,
      isKebabCase(suggestion) ? `fazon spec new ${suggestion}` : undefined,
    );
  }
  // The spec's name must give back the file name (SPEC-002), which a one-letter word or a word
  // of digits doesn't: `a-b` would be `AB`, whose file is `ab.md`.
  const name = pascalCase(component);
  if (kebabCase(name) !== component) {
    const fitting = kebabCase(name);
    return refused(
      `'${component}' can't name a component: its name would be ${name}, whose spec file is ${fitting}.md. Use ${fitting}, or another name whose words start with a letter and have more than one.`,
      `fazon spec new ${fitting}`,
    );
  }

  const option = invocation.options.tier;
  if (option !== undefined && !tiers.includes(option as Tier)) {
    return refused(
      `'${String(option)}' isn't a tier. Use ${tiers.slice(0, -1).join(", ")} or ${tiers.at(-1) ?? ""}.`,
      `fazon spec new ${component} --tier ${defaultTier}`,
    );
  }
  const tier = (option as Tier | undefined) ?? defaultTier;

  const loaded = await requireConfig(context);
  if ("refusal" in loaded) {
    return loaded.refusal;
  }
  const directory = loaded.config.paths.specs;
  const spec = path.posix.join(directory.split(path.sep).join("/"), `${component}.md`);
  const file = path.join(context.environment.cwd, directory, `${component}.md`);

  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, specScaffold(name, tier), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return refused(
        `${spec} exists already; fazon spec new never overwrites a spec. Edit it, or remove it first to start over.`,
        `fazon spec check ${component}`,
      );
    }
    throw error;
  }

  return {
    status: "ok",
    messages: [
      {
        level: "info",
        text: `Wrote ${spec}: ${name}, a ${tier}${option === undefined ? " (the default; --tier sets another)" : ""}. Replace its TODOs with the spec skill or by hand, then check it.`,
        hint: `fazon spec check ${component}`,
      },
    ],
    result: { spec, name, tier },
  };
}

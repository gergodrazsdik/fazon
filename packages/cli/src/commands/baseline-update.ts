// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon baseline update (<component>... [--story <name>]... | --all)` (docs/spec/cli.md#fazon-baseline-update,
// docs/spec/baseline-lifecycle.md#writing-baselines).
import { loadComponents, updateBaselines } from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { refused, type Message, type Outcome, type TextLine } from "../outcome.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

export async function baselineUpdate(invocation: Invocation, context: Context): Promise<Outcome> {
  const all = invocation.options.all === true;
  const storyOption = invocation.options.story;
  const stories = (Array.isArray(storyOption) ? storyOption : storyOption === undefined ? [] : [storyOption]).map(
    String,
  );
  const names = [...new Set(invocation.positionals)];
  const usage = "fazon baseline update <component>... [--story <name>]...  or  fazon baseline update --all";
  if (all && (names.length > 0 || stories.length > 0)) {
    return refused(
      `--all updates every component, so it takes no component or --story. Usage: ${usage}`,
      "fazon baseline update --help",
    );
  }
  if (!all && names.length === 0) {
    return refused(`Name the components to update, or pass --all. Usage: ${usage}`, "fazon baseline update --help");
  }

  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) {
    return refused(`fazon.yaml names the adapter '${config.adapter}', which this version of fazon doesn't have.`);
  }
  const root = context.environment.cwd;
  const { components, problems } = await loadComponents(root, config, adapter);
  if (problems.length > 0) {
    return {
      status: "refused",
      messages: [
        ...problems.map((p): Message => ({ level: "error", text: `${p.file}: ${p.message}` })),
        {
          level: "error",
          text: "fazon baseline update needs specs that pass `fazon spec check`.",
          hint: "fazon spec check",
        },
      ],
    };
  }
  const unknown = names.filter((name) => !components.some((c) => c.name === name));
  if (unknown.length > 0) {
    return refused(
      `No spec names ${unknown.join(", ")}: the components are ${components.map((c) => c.name).join(", ") || "none yet"}.`,
      "fazon baseline update --help",
    );
  }
  const chosen = components.filter((c) => names.includes(c.name));
  const knownStories = new Set(chosen.flatMap((c) => c.manifest?.stories.map((s) => s.name) ?? []));
  const strangers = stories.filter((story) => !knownStories.has(story));
  if (strangers.length > 0) {
    return refused(
      `--story names ${strangers.join(", ")}, which ${strangers.length === 1 ? "isn't a story" : "aren't stories"} of ${names.join(", ")}. Stories are named as in the component's generated/stories.json.`,
    );
  }

  const outcome = await updateBaselines({
    root,
    config,
    components,
    targets: all ? "all" : names,
    ...(stories.length === 0 ? {} : { stories }),
  });
  if (outcome.kind === "refused") {
    const failed = outcome.qualifications.flatMap((q) => q.failed);
    return {
      status: "refused",
      messages: [
        ...failed.map((text): Message => ({ level: "error", text })),
        {
          level: "error",
          text: "fazon baseline update writes only from a run that qualifies (docs/spec/baseline-lifecycle.md#writing-baselines); it wrote nothing.",
          hint: `fazon verify ${all ? "" : names.join(" ")}`.trim(),
        },
      ],
      result: { qualifications: outcome.qualifications },
    };
  }
  const text: TextLine[] = [
    ...outcome.written.map((file) => ({ stream: "stdout" as const, text: `written  ${file}` })),
    ...outcome.removed.map((file) => ({ stream: "stdout" as const, text: `removed  ${file}` })),
  ];
  const count = (n: number) => `${String(n)} ${n === 1 ? "baseline" : "baselines"}`;
  return {
    status: "ok",
    messages: [
      {
        level: "info",
        text: `Wrote ${count(outcome.written.length)}, kept ${count(outcome.unchanged.length)} unchanged, removed ${String(outcome.removed.length)} ${outcome.removed.length === 1 ? "orphan" : "orphans"}, from ${[...new Set(outcome.qualifications.map((q) => q.run))].join(", ")}. Commit them with the component.`,
      },
    ],
    text,
    result: {
      image: outcome.image,
      runs: outcome.qualifications.map((q) => ({
        component: q.component,
        run: q.run,
        ...(q.iteration === undefined ? {} : { iteration: q.iteration }),
      })),
      written: outcome.written,
      unchanged: outcome.unchanged,
      removed: outcome.removed,
    },
  };
}

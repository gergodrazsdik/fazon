// SPDX-License-Identifier: GPL-3.0-or-later
// The story file (docs/spec/adapter-boundary.md#stories): a CSF 3 file for Storybook 10 with
// `@storybook/vue3-vite`, one export per manifest story. Each story renders its fixture with the
// story's `set` values through Vue's `h`, inside the story frame.
import path from "node:path";
import {
  AdapterError,
  kebabCase,
  storyExportName,
  type ComponentName,
  type Content,
  type ContentNode,
  type GenerateInput,
  type Instance,
  type ManifestFixture,
  type PropValues,
  type Spec,
  type Story,
  type StorySet,
} from "@fazon/core";
import { mapComponent, typeExpression, type VueComponent, type VueScope } from "./api.js";
import { template } from "./template.js";

const stories = template("stories.ts.tmpl");

/** The story file's name: `<Component>.stories.ts`. */
export function storyFileName(spec: Spec): string {
  return `${spec.name}.stories.ts`;
}

/** What a story file imports, collected while its stories are written. */
class Imports {
  /** Identifier to the module it's the default export of, in the order first used. */
  readonly components = new Map<string, string>();
  readonly icons = new Map<string, string>();
  ref = false;

  constructor(readonly input: GenerateInput) {}

  component(name: string, file: string): string {
    this.components.set(name, file);
    return name;
  }

  icon(name: string): string {
    const identifier = `icon${name.split("-").map(capitalise).join("")}`;
    const { icons } = this.input;
    const from =
      icons === "lucide"
        ? `lucide-static/icons/${name}.svg`
        : relativeImport(generatedPath(this.input), path.posix.join(icons.path, `${name}.svg`));
    this.icons.set(identifier, from);
    return identifier;
  }
}

/** The text of `generated/<Component>.stories.ts`, before formatting. */
export function storyFileText(
  input: GenerateInput,
  component: VueComponent = mapComponent(input.spec, input.specFile),
): string {
  const { spec, manifest, specFile } = input;
  const imports = new Imports(input);
  const fail = (message: string, hint = `Fix ${specFile}.`) => new AdapterError(message, { file: specFile, hint });
  const root = component.scopes[0];
  if (root === undefined) throw fail(`${spec.name} has no component.`);
  imports.component(root.exportName, `../${root.file}`);

  const used = new Map<ComponentName, VueComponent>();
  for (const name of spec.uses ?? []) {
    const other = input.uses[name];
    if (other === undefined) {
      throw fail(
        `${spec.name} uses ${name}, which has no spec.`,
        `Write specs/${kebabCase(name)}.md, or remove ${name} from uses (SPEC-008).`,
      );
    }
    used.set(name, mapComponent(other, path.posix.join(path.posix.dirname(specFile), `${kebabCase(name)}.md`)));
  }

  const texts: string[] = [];
  const exportNames = new Set<string>();
  for (const story of manifest.stories) {
    const fixture = manifest.fixtures[story.fixture];
    if (fixture === undefined) throw fail(`The manifest has no fixture ${story.fixture}.`);
    const name = storyExportName(spec.name, story.name);
    if (exportNames.has(name) || reserved.has(name) || name === root.exportName) {
      throw fail(
        `The story ${story.name} would be exported as ${name}, a name the story file already uses.`,
        "Rename a fixture or a state so the story names differ.",
      );
    }
    exportNames.add(name);
    const writer = new StoryWriter(component, used, imports, story, fixture, fail);
    const tree = writer.root();
    const body =
      writer.models.length === 0
        ? stories.fill("static-component", { tree })
        : stories.fill("stateful-component", { tree, models: writer.models.join("\n") });
    texts.push(
      stories.fill("story", {
        name,
        width: fixture.frame === undefined ? "" : String(fixture.frame.width),
        component: body,
      }),
    );
  }

  for (const identifier of imports.components.keys()) {
    if (exportNames.has(identifier))
      throw fail(
        `A story's export name, ${identifier}, is also a component's name.`,
        "Rename a fixture or a state so the story names differ.",
      );
  }

  // The component, its parts in the spec's order, then the components it uses; icons by name.
  const order = [...component.scopes, ...[...used.values()].flatMap((other) => other.scopes.slice(0, 1))].map(
    (scope) => scope.exportName,
  );
  const importLines = [
    ...order.flatMap((name) => {
      const from = imports.components.get(name);
      return from === undefined ? [] : [stories.fill("vue-import", { name, path: from })];
    }),
    ...[...imports.icons]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, from]) => stories.fill("icon-import", { name, path: from })),
  ];
  return stories.fill("file", {
    spec: specFile,
    vue: imports.ref ? "h, ref" : "h",
    imports: importLines.join("\n"),
    baseStyles: input.baseStyles
      .map(({ property, value }) =>
        stories.fill("base-style", { property: camelCaseProperty(property), value: JSON.stringify(value) }),
      )
      .join("\n"),
    defaultTheme: JSON.stringify(manifest.themes[0] ?? "light"),
    helpers: imports.icons.size > 0 ? stories.fill("icon-helper") : "",
    title: JSON.stringify(spec.name),
    component: root.exportName,
    stories: texts.join("\n"),
  });
}

/** Identifiers the story file declares itself. */
const reserved = new Set(["baseStyles", "frame", "icon", "meta", "h", "ref"]);

type Fail = (message: string, hint?: string) => AdapterError;

/** Writes one story's render tree. */
class StoryWriter {
  readonly models: string[] = [];
  readonly #children = new Map<ComponentName, ComponentName[]>();

  constructor(
    readonly component: VueComponent,
    readonly used: ReadonlyMap<ComponentName, VueComponent>,
    readonly imports: Imports,
    readonly story: Story,
    readonly fixture: ManifestFixture,
    readonly fail: Fail,
  ) {
    const { spec } = component;
    for (const [part, definition] of Object.entries(spec.parts ?? {})) {
      const siblings = this.#children.get(definition.parent) ?? [];
      siblings.push(part);
      this.#children.set(definition.parent, siblings);
    }
  }

  /** The component, with its parts' instances nested by `parent`. */
  root(): string {
    const { spec } = this.component;
    const scope = this.scope(spec.name);
    const props = this.apply(this.fixture.props ?? {}, "root", 0);
    const parts = this.childrenOf(spec.name, 0, 1);
    return this.element(scope, props, this.fixture.slots ?? {}, parts);
  }

  /** The rendered instances of the parts whose parent is `parent`, for its `index`th of `count` instances. */
  childrenOf(parent: ComponentName, index: number, count: number): string[] {
    const rendered: string[] = [];
    for (const part of this.#children.get(parent) ?? []) {
      const instances = this.fixture.parts?.[part] ?? [];
      const mine = instancesOf(instances, index, count);
      if (mine === undefined) {
        throw this.fail(
          `The fixture ${this.story.fixture} has ${String(instances.length)} instances of ${part}, which can't be shared among ${String(count)} instances of ${parent}.`,
          `Give ${part} one instance for each instance of ${parent}, or one in all.`,
        );
      }
      for (const [position, instance] of mine) {
        const scope = this.scope(part);
        const props = this.apply(instance.props ?? {}, part, position);
        const nested = this.childrenOf(part, position, instances.length);
        rendered.push(this.element(scope, props, instance.slots ?? {}, nested));
      }
    }
    return rendered;
  }

  scope(name: ComponentName): VueScope {
    const scope = this.component.byName.get(name);
    if (scope === undefined) throw this.fail(`The spec has no part ${name}.`);
    return scope;
  }

  /** An instance's props, then the story's `set` values that target it, in order; `part` is `root` for the component. */
  apply(props: PropValues, part: string, instance: number): Record<string, unknown> {
    const result: Record<string, unknown> = { ...props };
    for (const set of this.story.set ?? []) {
      if (targets(set, part, instance, this.fail)) Object.assign(result, set.props);
    }
    return result;
  }

  /** `h(<component>, <props>, <slots>)`, with the parts first in its default slot. */
  element(
    scope: VueScope,
    props: Record<string, unknown>,
    slots: Readonly<Record<string, Content>>,
    parts: readonly string[],
  ): string {
    const component = this.imports.component(scope.exportName, `../${scope.file}`);
    return this.vnode(scope, component, props, slots, parts);
  }

  vnode(
    scope: VueScope,
    component: string,
    props: Record<string, unknown>,
    slots: Readonly<Record<string, Content>>,
    parts: readonly string[] = [],
  ): string {
    const entries: string[] = [];
    for (const [neutral, value] of Object.entries(props)) {
      const prop = scope.props.find((p) => p.neutral === neutral);
      if (prop === undefined) {
        throw this.fail(
          `The fixture ${this.story.fixture} sets ${scope.name}'s ${neutral}, which its Vue API doesn't have (extensions.vue.omit).`,
        );
      }
      if (prop.model) {
        const variable = `model${String(this.models.length)}`;
        const type = typeExpression(prop.prop) + (prop.prop.required === true ? "" : " | undefined");
        this.imports.ref = true;
        this.models.push(stories.fill("model", { variable, type, value: JSON.stringify(value) }));
        entries.push(stories.fill("model-props", { prop: prop.name, variable, type }));
      } else {
        entries.push(stories.fill("prop", { name: JSON.stringify(prop.name), value: JSON.stringify(value) }));
      }
    }

    const slotEntries: string[] = [];
    const contentOf = new Map<string, string[]>();
    if (parts.length > 0) contentOf.set("default", [...parts]);
    for (const [neutral, content] of Object.entries(slots)) {
      const nodes = (Array.isArray(content) ? content : [content]) as readonly ContentNode[];
      contentOf.set(neutral, [...(contentOf.get(neutral) ?? []), ...nodes.map((node) => this.node(node))]);
    }
    for (const [neutral, nodes] of contentOf) {
      const name = scope.slotNames.get(neutral);
      if (name === undefined) {
        throw this.fail(
          `The fixture ${this.story.fixture} fills ${scope.name}'s slot ${neutral}, which its Vue API doesn't have.`,
        );
      }
      const content = nodes.length === 1 ? (nodes[0] ?? "") : stories.fill("list", { items: nodes.join(", ") });
      slotEntries.push(stories.fill("slot", { name: JSON.stringify(name), content }));
    }

    const propsText =
      entries.length === 0 ? stories.fill("no-props") : stories.fill("props", { entries: entries.join("\n") });
    if (slotEntries.length === 0) {
      return entries.length === 0
        ? stories.fill("element-bare", { component })
        : stories.fill("element-without-slots", { component, props: propsText });
    }
    return stories.fill("element", {
      component,
      props: propsText,
      slots: stories.fill("slots", { entries: slotEntries.join("\n") }),
    });
  }

  /** One node of slot content: text, an icon or another component. */
  node(node: ContentNode): string {
    if (typeof node === "string") return JSON.stringify(node);
    if ("text" in node) return JSON.stringify(node.text);
    if ("icon" in node) return stories.fill("icon", { name: this.imports.icon(node.icon) });
    const other = this.used.get(node.component);
    const scope = other?.scopes[0];
    if (other === undefined || scope === undefined) {
      throw this.fail(
        `The fixture ${this.story.fixture} renders ${node.component}, which isn't in uses.`,
        `Add ${node.component} to uses (SPEC-008).`,
      );
    }
    const component = this.imports.component(scope.exportName, `../../${kebabCase(other.spec.name)}/${scope.file}`);
    return this.vnode(scope, component, { ...node.props }, node.slots ?? {});
  }
}

/**
 * Which of a part's instances belong to the `index`th of its parent's `count` instances: all of
 * them when the parent has one instance, else the one at the same position.
 * @returns [position in the fixture's list, instance] pairs; undefined when they can't be shared out
 */
function instancesOf(instances: readonly Instance[], index: number, count: number): [number, Instance][] | undefined {
  if (count <= 1) return instances.map((instance, position) => [position, instance]);
  if (instances.length === 0) return [];
  if (instances.length !== count) return undefined;
  const instance = instances[index];
  return instance === undefined ? [] : [[index, instance]];
}

/** Whether a `set` entry's target is this instance: `root`, `<Part>[*]` or `<Part>[<n>]`. */
function targets(set: StorySet, part: string, instance: number, fail: Fail): boolean {
  if (set.target === "root") return part === "root";
  const match = /^([A-Z][A-Za-z0-9]*)\[(\*|[0-9]+|default)\]$/.exec(set.target);
  if (match === null || match[2] === "default") {
    throw fail(`A story sets props on ${set.target}, which a story file can't target.`);
  }
  return match[1] === part && (match[2] === "*" || Number(match[2]) === instance);
}

function generatedPath(input: GenerateInput): string {
  return path.posix.join(input.directory, "generated");
}

/** An import path from one directory to a file, both relative to the repository root. */
export function relativeImport(from: string, to: string): string {
  const relative = path.posix.relative(from, to);
  return relative.startsWith("../") ? relative : `./${relative}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function camelCaseProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

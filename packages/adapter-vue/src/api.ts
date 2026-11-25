// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue API mapping (docs/spec/adapter-boundary.md#api-mapping): the neutral API, with the
// `extensions.vue` block applied, as the Vue component files offer it. `generated/api.json` holds it
// for the contract tests, and the story files bind props and models by its names.
import {
  AdapterError,
  type Api,
  type ComponentName,
  type Event,
  type Extension,
  type Method,
  type Prop,
  type Slot,
  type Spec,
  type TypeFields,
  type ValueType,
} from "@fazon/core";

/** The adapter's ID: `extensions.vue` and `adapter: vue`. */
export const adapterId = "vue";

/** A value type as api.json writes it: `type`, with `values` for an enum and `items` for an array. */
export type VueType = TypeFields;

/** A prop as `defineProps` or `defineModel` declares it. */
export type VueProp = VueType & {
  readonly required: boolean;
  /** The default, as the spec writes it; absent when there's none. */
  readonly default?: unknown;
};

/** An event as `defineEmits` declares it; a model's `update:<prop>` event too. */
export interface VueEvent {
  readonly payload?: VueType;
}

/** A slot as `defineSlots` declares it; `props` are the scoped slot's props (the slot's `data`). */
export interface VueSlot {
  readonly required: boolean;
  readonly props: Readonly<Record<string, VueType>>;
}

/** A member `defineExpose` exposes: a method. */
export interface VueExposed {
  readonly params: Readonly<Record<string, VueType>>;
  readonly returns?: VueType;
}

/** One single-file component's API, as vue-component-meta reads it (ADAPTER-004). */
export interface VueComponentApi {
  /** The file, in the component's directory. */
  readonly file: string;
  readonly props: Readonly<Record<string, VueProp>>;
  readonly events: Readonly<Record<string, VueEvent>>;
  readonly slots: Readonly<Record<string, VueSlot>>;
  readonly exposed: Readonly<Record<string, VueExposed>>;
}

/** `generated/api.json`: the approved API after the Vue mapping. */
export interface VueApiFile {
  readonly fazon: 0;
  readonly adapter: typeof adapterId;
  /** The component's name. */
  readonly component: ComponentName;
  /** The spec's path, relative to the repository root. */
  readonly spec: string;
  /** The component that receives undeclared attributes, classes and the ref (`forward`). */
  readonly forward: string;
  /** The form field's props, by their Vue names (`form`). */
  readonly form?: Readonly<Record<string, string>>;
  /** Each single-file component's API: the component's first, then each part's, keyed by component name. */
  readonly components: Readonly<Record<string, VueComponentApi>>;
}

/** A prop of one component or part, with the name the spec gives it and the one Vue uses. */
export interface MappedProp {
  /** The spec's name; absent for a prop `extensions.vue.add` adds. */
  readonly neutral?: string;
  /** The Vue prop: `modelValue` for the model named `value`. */
  readonly name: string;
  readonly prop: Prop;
  /** Two-way bound: set it with `name` and listen to `update:<name>`. */
  readonly model: boolean;
}

/** One single-file component: the component itself, or one part. */
export interface VueScope {
  /** The component's or the part's name, as the spec writes it. */
  readonly name: ComponentName;
  readonly part?: ComponentName;
  /** The component's name in Vue, and its file's base name: `TabsTrigger`. */
  readonly exportName: string;
  readonly file: string;
  readonly props: readonly MappedProp[];
  /** The Vue name of each slot, by the spec's name. */
  readonly slotNames: ReadonlyMap<string, string>;
  readonly api: VueComponentApi;
}

/** The Vue view of a spec: the component's scope first, then each part's, in declaration order. */
export interface VueComponent {
  readonly spec: Spec;
  readonly scopes: readonly VueScope[];
  /** By the spec's name: the component's name for the root, a part's name for a part. */
  readonly byName: ReadonlyMap<string, VueScope>;
}

const kinds = ["props", "events", "slots", "methods"] as const;
type Kind = (typeof kinds)[number];
type Member = Prop | Event | Slot | Method;
interface KindMember {
  props: Prop;
  events: Event;
  slots: Slot;
  methods: Method;
}
interface Entry<M> {
  /** The spec's name; absent for an added member. */
  neutral?: string;
  /** The name in Vue. */
  name: string;
  member: M;
}
const camelCase = /^[a-z][A-Za-z0-9]*$/;

/** The schema of a `map` value in `extensions.vue`: `{ name: <camelCase> }`, to rename a member. */
export const mapValueSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", pattern: camelCase.source, description: "The member's name in Vue, in camelCase." },
  },
} as const;

/** The file and component name of the component (`Tabs`) or of a part (`TabsTrigger`). */
export function vueComponentName(component: ComponentName, part?: ComponentName): string {
  return part === undefined ? component : `${component}${part}`;
}

/**
 * Maps a spec's API to Vue, applying `extensions.vue`: `omit` drops members, `add` adds them, and
 * `map` renames them. A model prop becomes `modelValue` when it's named `value`, with its
 * `update:<prop>` event; slot `data` becomes the scoped slot's props; methods are exposed.
 * @throws AdapterError when the block can't be applied
 */
export function mapComponent(spec: Spec, specFile: string): VueComponent {
  const extension = spec.extensions?.[adapterId];
  const edits = readExtension(extension, spec, specFile);
  const scopes: VueScope[] = [scope(spec, undefined, spec, edits, specFile)];
  for (const [part, definition] of Object.entries(spec.parts ?? {})) {
    scopes.push(scope(spec, part, definition, edits, specFile));
  }
  for (const path of edits.keys()) {
    const [first, second] = path.split(".");
    if (first === "parts" && (second === undefined || spec.parts?.[second] === undefined)) {
      throw new AdapterError(`extensions.vue names ${path}, but the spec has no part ${second ?? ""}.`, {
        file: specFile,
        hint: "Name a part the spec declares (SPEC-013).",
      });
    }
  }
  return {
    spec,
    scopes,
    byName: new Map(scopes.map((s) => [s.part ?? s.name, s])),
  };
}

/** The api.json document of a component. */
export function apiFile(component: VueComponent, specFile: string): VueApiFile {
  const { spec } = component;
  const root = component.scopes[0];
  const forwardScope =
    spec.forward === undefined || spec.forward === "root" ? root : component.byName.get(spec.forward);
  const rootProp = (neutral: string) => root?.props.find((p) => p.neutral === neutral)?.name ?? neutral;
  const { form: fields } = spec;
  const form =
    fields === undefined
      ? undefined
      : Object.fromEntries(
          (["value", "name", "disabled", "required"] as const).flatMap((field) => {
            const prop = fields[field];
            return prop === undefined ? [] : [[field, rootProp(prop)]];
          }),
        );
  return {
    fazon: 0,
    adapter: adapterId,
    component: spec.name,
    spec: specFile,
    forward: forwardScope?.exportName ?? spec.name,
    ...(form === undefined ? {} : { form }),
    components: Object.fromEntries(component.scopes.map((s) => [s.exportName, s.api])),
  };
}

/** The TypeScript type of a value type: `"sm" | "md"`, `string[]`. */
export function typeExpression(type: VueType): string {
  switch (type.type) {
    case "boolean":
    case "string":
    case "number":
      return type.type;
    case "enum":
      return type.values.map((value) => JSON.stringify(value)).join(" | ");
    case "array": {
      const items = typeExpression(type.items);
      return type.items.type === "enum" && type.items.values.length > 1 ? `(${items})[]` : `${items}[]`;
    }
  }
}

/** The edits `extensions.vue` makes, by member path. */
type Edit =
  | { readonly kind: "omit" }
  | { readonly kind: "add"; readonly member: Member }
  | { readonly kind: "map"; readonly name: string };

function readExtension(extension: Extension | undefined, spec: Spec, specFile: string): Map<string, Edit> {
  const edits = new Map<string, Edit>();
  if (extension === undefined) return edits;
  const fail = (message: string, hint: string): never => {
    throw new AdapterError(message, { file: specFile, hint });
  };
  if (extension.options !== undefined) {
    fail("extensions.vue has options, and the Vue adapter takes none in version 0.", "Remove extensions.vue.options.");
  }
  const set = (path: string, edit: Edit) => {
    if (edits.has(path)) fail(`extensions.vue names ${path} more than once.`, "Keep one of its entries (SPEC-013).");
    edits.set(path, edit);
  };
  for (const path of Object.keys(extension.omit ?? {})) {
    if (memberAt(spec, path) === undefined)
      fail(
        `extensions.vue.omit names ${path}, which the spec doesn't have.`,
        "Omit a member the spec declares (SPEC-013).",
      );
    set(path, { kind: "omit" });
  }
  for (const [path, member] of Object.entries(extension.add ?? {}) as [string, Member][]) {
    if (memberAt(spec, path) !== undefined)
      fail(
        `extensions.vue.add adds ${path}, which the spec already has.`,
        "Add only members the neutral API lacks (SPEC-013).",
      );
    set(path, { kind: "add", member });
  }
  for (const [path, value] of Object.entries(extension.map ?? {})) {
    const keys = Object.keys(value);
    const name = value.name;
    if (keys.length !== 1 || typeof name !== "string" || !camelCase.test(name)) {
      fail(
        `extensions.vue.map.${path} must be { name: <camelCase> }, the member's name in Vue.`,
        "The Vue adapter's map renames a member and takes nothing else.",
      );
    }
    if (memberAt(spec, path) === undefined)
      fail(
        `extensions.vue.map names ${path}, which the spec doesn't have.`,
        "Map a member the spec declares (SPEC-013).",
      );
    set(path, { kind: "map", name: name as string });
  }
  return edits;
}

function memberAt(spec: Spec, path: string): Member | undefined {
  const segments = path.split(".");
  const api: Api | undefined = segments[0] === "parts" ? spec.parts?.[segments[1] ?? ""] : spec;
  const [kind, name] = segments[0] === "parts" ? segments.slice(2) : segments;
  if (api === undefined || name === undefined || !(kinds as readonly string[]).includes(kind ?? "")) return undefined;
  return (api[kind as Kind] as Readonly<Record<string, Member>> | undefined)?.[name];
}

function scope(
  spec: Spec,
  part: ComponentName | undefined,
  api: Api,
  edits: Map<string, Edit>,
  specFile: string,
): VueScope {
  const prefix = part === undefined ? "" : `parts.${part}.`;
  const members = <K extends Kind>(kind: K): Entry<KindMember[K]>[] => {
    const list: Entry<KindMember[K]>[] = [];
    for (const [name, member] of Object.entries((api[kind] ?? {}) as Readonly<Record<string, KindMember[K]>>)) {
      const edit = edits.get(`${prefix}${kind}.${name}`);
      if (edit?.kind === "omit") continue;
      list.push({ neutral: name, name: edit?.kind === "map" ? edit.name : name, member });
    }
    for (const [path, edit] of edits) {
      const match = path.startsWith(`${prefix}${kind}.`) ? path.slice(prefix.length + kind.length + 1) : undefined;
      if (edit.kind === "add" && match !== undefined && !match.includes("."))
        list.push({ name: match, member: edit.member as KindMember[K] });
    }
    return list;
  };

  const exportName = vueComponentName(spec.name, part);
  const props: MappedProp[] = members("props").map(({ neutral, name, member }) => {
    const model = member.model === true;
    return {
      ...(neutral === undefined ? {} : { neutral }),
      name: model && name === "value" ? "modelValue" : name,
      prop: member,
      model,
    };
  });
  const events: Record<string, VueEvent> = {};
  const used = new Set<string>();
  const claim = (kind: string, name: string) => {
    if (used.has(`${kind}:${name}`)) {
      throw new AdapterError(`${exportName} would have two ${kind} named ${name} in Vue.`, {
        file: specFile,
        hint: "Rename one of them with extensions.vue.map.",
      });
    }
    used.add(`${kind}:${name}`);
  };
  for (const { name, member } of members("events")) {
    claim("events", name);
    events[name] = member.payload === undefined ? {} : { payload: typeFields(member.payload) };
  }
  for (const { name, prop, model } of props) {
    claim("props", name);
    if (model) {
      claim("events", `update:${name}`);
      events[`update:${name}`] = { payload: typeFields(prop) };
    }
  }
  const slots: Record<string, VueSlot> = {};
  const slotNames = new Map<string, string>();
  for (const { neutral, name, member } of members("slots")) {
    claim("slots", name);
    if (neutral !== undefined) slotNames.set(neutral, name);
    slots[name] = {
      required: member.required === true,
      props: Object.fromEntries(Object.entries(member.data ?? {}).map(([key, type]) => [key, typeFields(type)])),
    };
  }
  // The parts whose parent this is render in its default slot, which it has even when the spec
  // declares none; it's required when one of them must be there.
  const children = Object.values(spec.parts ?? {}).filter((child) => child.parent === (part ?? spec.name));
  if (children.length > 0 && !slotNames.has("default")) {
    claim("slots", "default");
    slotNames.set("default", "default");
    slots.default = { required: children.some((child) => child.count === "one"), props: {} };
  }
  const exposed: Record<string, VueExposed> = {};
  for (const { name, member } of members("methods")) {
    claim("exposed", name);
    exposed[name] = {
      params: Object.fromEntries(Object.entries(member.params ?? {}).map(([key, type]) => [key, typeFields(type)])),
      ...(member.returns === undefined ? {} : { returns: typeFields(member.returns) }),
    };
  }

  const file = `${exportName}.vue`;
  return {
    name: part ?? spec.name,
    ...(part === undefined ? {} : { part }),
    exportName,
    file,
    props,
    slotNames,
    api: {
      file,
      props: Object.fromEntries(
        props.map(({ name, prop }) => [
          name,
          {
            ...typeFields(prop),
            required: prop.required === true,
            ...(prop.default === undefined ? {} : { default: prop.default }),
          },
        ]),
      ),
      events,
      slots,
      exposed,
    },
  };
}

/** Only the type: `type`, `values` and `items`, without descriptions or other fields. */
function typeFields(type: ValueType | Prop | TypeFields): VueType {
  switch (type.type) {
    case "enum":
      return { type: "enum", values: [...type.values] };
    case "array":
      return {
        type: "array",
        items: typeFields(type.items) as VueType & { type: "boolean" | "string" | "number" | "enum" },
      };
    default:
      return { type: type.type };
  }
}

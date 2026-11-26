// SPDX-License-Identifier: GPL-3.0-or-later
// The spec front matter as TypeScript types. docs/spec/schemas/spec.schema.json is the source of
// truth and docs/spec/spec-format.md explains it; these types follow the schema, so a value that
// passes SPEC-001 has these types. A change to the schema changes them in the same pull request.
// Rules that need more than the schema (SPEC-002 onwards) are not expressed here.

/** PascalCase: a component or part, such as `Button` or `Trigger`. */
export type ComponentName = string;
/** camelCase: a prop, event, slot, method or parameter, such as `variant`. */
export type MemberName = string;
/** kebab-case: an enum value, state, fixture, check, rule or adapter ID, such as `focus-visible`. */
export type KebabName = string;
/** A dotted token path, as in the token set, such as `color.action.primary`. */
export type TokenName = string;

export type Tier = "primitive" | "form-control" | "composite";

/** The element type of an array. */
export type ItemType =
  { readonly type: "boolean" | "string" | "number" } | { readonly type: "enum"; readonly values: readonly KebabName[] };

/** A value type: `values` comes with an enum, `items` with an array. */
export type TypeFields =
  | { readonly type: "boolean" | "string" | "number" }
  | { readonly type: "enum"; readonly values: readonly KebabName[] }
  | { readonly type: "array"; readonly items: ItemType };

export type TypeName = TypeFields["type"];

/** An event payload, a slot's data, a method's parameters and result. */
export type ValueType = TypeFields & { readonly description?: string };

interface PropFields {
  readonly description?: string;
  /** A required prop has no default. */
  readonly required?: boolean;
  /** Two-way bound; its change notification is implied. */
  readonly model?: boolean;
}

/** A prop; its default has the prop's type (SPEC-004 checks an enum's and an array's further). */
export type Prop = PropFields &
  (
    | { readonly type: "boolean"; readonly default?: boolean }
    | { readonly type: "string"; readonly default?: string }
    | { readonly type: "number"; readonly default?: number }
    | { readonly type: "enum"; readonly values: readonly KebabName[]; readonly default?: string }
    | { readonly type: "array"; readonly items: ItemType; readonly default?: readonly unknown[] }
  );

export interface Event {
  readonly description?: string;
  readonly payload?: ValueType;
}

export interface Slot {
  readonly description?: string;
  readonly required?: boolean;
  /** Values the component passes to the slot's content. */
  readonly data?: Readonly<Record<MemberName, ValueType>>;
}

export interface Method {
  readonly description?: string;
  readonly params?: Readonly<Record<MemberName, ValueType>>;
  readonly returns?: ValueType;
}

/** The neutral API of the component or of one part. */
export interface Api {
  readonly props?: Readonly<Record<MemberName, Prop>>;
  readonly events?: Readonly<Record<MemberName, Event>>;
  readonly slots?: Readonly<Record<MemberName, Slot>>;
  readonly methods?: Readonly<Record<MemberName, Method>>;
}

/** A prop value in a recipe, a fixture or a condition. */
export type PropValue = boolean | string | number | readonly unknown[];

export type PropValues = Readonly<Record<MemberName, PropValue>>;

/** `root`, a part (its first instance), or `<Part>[<n>]`. */
export type Target = string;

/** One input step the verifier performs. `press` sends a key to the focused element. */
export type InputStep =
  | { readonly action: "hover" | "focus" | "pointer-down" | "click"; readonly target: Target }
  | { readonly action: "press"; readonly key: string }
  | { readonly action: "scroll"; readonly target: Target; readonly to: "start" | "end" };

export type InputAction = InputStep["action"];

/** How a state is produced, when the story matrix rules can't infer it. */
export interface Recipe {
  /** `false`: the fixtures already show the state, so it gets no story of its own. */
  readonly story?: boolean;
  /** For a part's state: the instance the recipe applies to, from 0. */
  readonly instance?: number;
  readonly props?: PropValues;
  readonly input?: readonly InputStep[];
}

/** Where an accessible name or description comes from. */
export type NameSource = "content" | "none" | `prop:${MemberName}` | `part:${ComponentName}`;

export interface Focus {
  /** Arrow keys move focus between this part's instances. */
  readonly roving?: ComponentName;
  readonly trap?: boolean;
  readonly restore?: boolean;
  /** The part that receives focus on open. */
  readonly initial?: ComponentName;
}

export interface A11y {
  readonly role?: string;
  readonly name?: NameSource;
  readonly describedBy?: NameSource;
  /** ARIA attribute to when it's set. */
  readonly aria?: Readonly<Record<string, string>>;
  /** Key, with optional modifiers such as `Shift+Tab`, to its effect. */
  readonly keyboard?: Readonly<Record<string, string>>;
  readonly focus?: Focus;
}

/** What the component and each part have besides the API: states, recipes and accessibility. */
export interface Stateful extends Api {
  readonly states?: readonly KebabName[];
  readonly produce?: Readonly<Record<KebabName, Recipe>>;
  readonly a11y?: A11y;
}

export type PartCount = "one" | "optional" | "many";

export interface Part extends Stateful {
  readonly description?: string;
  /** The component, or another part. */
  readonly parent: ComponentName;
  readonly count: PartCount;
  /** Rendered outside the component's root, such as in an overlay layer. */
  readonly portal?: boolean;
}

export interface Form {
  /** The prop holding the submitted value; a `model` prop. */
  readonly value: MemberName;
  readonly name?: MemberName;
  readonly disabled?: MemberName;
  readonly required?: MemberName;
}

/** One node of slot content. A plain string is text. */
export type ContentNode = string | TextNode | ParagraphNode | IconNode | ComponentNode;

/** Inline text, with nothing around it. */
export interface TextNode {
  readonly text: string;
}

/** A paragraph of plain text: `<p>` on the web. */
export interface ParagraphNode {
  readonly p: string;
}

/** An icon of the fixture icon set. */
export interface IconNode {
  readonly icon: KebabName;
}

export interface ComponentNode {
  /** Another component, listed in `uses`. */
  readonly component: ComponentName;
  readonly props?: PropValues;
  readonly slots?: SlotContent;
}

/** Slot content: one node, or a list rendered in order. */
export type Content = ContentNode | readonly ContentNode[];

export type SlotContent = Readonly<Record<MemberName, Content>>;

/** One instance of a part in a fixture. */
export interface Instance {
  readonly props?: PropValues;
  readonly slots?: SlotContent;
}

export interface Frame {
  /** In CSS pixels. */
  readonly width: number;
}

export interface Fixture {
  readonly description?: string;
  /** Another fixture this one starts from. */
  readonly extends?: KebabName;
  readonly props?: PropValues;
  readonly slots?: SlotContent;
  /** Each part's instances, in order; replaces the base's list. */
  readonly parts?: Readonly<Record<ComponentName, readonly Instance[]>>;
  readonly frame?: Frame;
}

/** A condition: every given field must hold. */
export interface When {
  readonly props?: PropValues;
  readonly state?: KebabName;
}

/** `<prop>` or `<Part>.<prop>`. */
export type AxisName = string;

/** A story the grids don't make. A point that names a part names the part's state too. */
export type MatrixPoint = {
  readonly fixture?: KebabName;
  readonly props?: Readonly<Record<AxisName, boolean | string | number>>;
} & (
  { readonly part: ComponentName; readonly state: KebabName } | { readonly part?: never; readonly state?: KebabName }
);

/** A combination that gets no story. */
export interface MatrixCondition {
  readonly part?: ComponentName;
  readonly props?: Readonly<Record<AxisName, PropValue>>;
  readonly state?: KebabName;
}

export interface Matrix {
  readonly axes?: readonly AxisName[];
  readonly fixtures?: readonly KebabName[];
  readonly exclude?: readonly MatrixCondition[];
  readonly include?: readonly MatrixPoint[];
}

export interface TokenRule {
  readonly part?: ComponentName;
  readonly when?: When;
  /** CSS property to the role token its computed value must match. */
  readonly use: Readonly<Record<string, TokenName>>;
}

export interface Exemption {
  readonly check: KebabName;
  readonly rule: KebabName;
  readonly part?: ComponentName;
  readonly fixture?: KebabName;
  readonly when?: When;
  readonly reason: string;
}

export interface JudgeQuestion {
  readonly id: KebabName;
  readonly question: string;
  readonly select?: {
    readonly fixture?: KebabName;
    readonly part?: ComponentName;
    readonly when?: When;
  };
}

type PartPrefix = "" | `parts.${ComponentName}.`;

/** A member of the neutral API: `<kind>.<name>` or `parts.<Part>.<kind>.<name>`. */
export type MemberPath = `${PartPrefix}${"props" | "events" | "slots" | "methods"}.${MemberName}`;

/** Members that exist only in one framework, keyed by path; the path's kind gives the member's form. */
export interface ExtensionAdditions {
  readonly [path: `${PartPrefix}props.${MemberName}`]: Prop;
  readonly [path: `${PartPrefix}events.${MemberName}`]: Event;
  readonly [path: `${PartPrefix}slots.${MemberName}`]: Slot;
  readonly [path: `${PartPrefix}methods.${MemberName}`]: Method;
}

export interface Omission {
  readonly reason?: string;
  /** The member that replaces it. */
  readonly instead?: MemberPath;
}

/** One adapter's additions to the neutral API. */
export interface Extension {
  readonly reason?: string;
  /** Component-level settings; the adapter defines and checks them. */
  readonly options?: Readonly<Record<string, unknown>>;
  /** How a neutral member maps in this framework; the adapter defines and checks the values. */
  readonly map?: Readonly<Record<MemberPath, Readonly<Record<string, unknown>>>>;
  readonly add?: ExtensionAdditions;
  readonly omit?: Readonly<Record<MemberPath, Omission>>;
}

/** The front matter of a component spec, format version 0. */
export interface Spec extends Stateful {
  readonly fazon: 0;
  readonly name: ComponentName;
  readonly tier: Tier;
  readonly summary: string;
  /** A reference image, relative to the spec. */
  readonly reference?: string;
  /** Other components this one renders or composes. */
  readonly uses?: readonly ComponentName[];
  /** `root` or a part name. */
  readonly forward?: string;
  readonly form?: Form;
  readonly parts?: Readonly<Record<ComponentName, Part>>;
  readonly fixtures?: Readonly<Record<KebabName, Fixture>>;
  readonly matrix?: Matrix;
  readonly tokens?: readonly TokenRule[];
  readonly exemptions?: readonly Exemption[];
  readonly judge?: readonly JudgeQuestion[];
  /** Keyed by adapter ID: `vue`, `react`, `angular`, `svelte`, `web-components`. */
  readonly extensions?: Readonly<Record<KebabName, Extension>>;
}

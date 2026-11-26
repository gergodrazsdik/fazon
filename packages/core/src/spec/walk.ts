// SPDX-License-Identifier: GPL-3.0-or-later
// Walks over the parts of a spec that several SPEC rules read: slot content nodes, extension
// member paths and props.
import type { PathSegment } from "../validation/validate.js";
import type { ComponentName, Content, ContentNode, MemberName, Prop, SlotContent, Spec } from "./types.js";

export type MemberKind = "props" | "events" | "slots" | "methods";

/** One content node, with where it is in the front matter. */
export interface PlacedNode {
  readonly node: ContentNode;
  readonly segments: readonly PathSegment[];
}

/** The nodes of slot content, in order, with the nodes in their components' slots after each. */
export function slotNodes(slots: SlotContent | undefined, segments: readonly PathSegment[]): PlacedNode[] {
  const placed: PlacedNode[] = [];
  for (const [slot, content] of Object.entries(slots ?? {})) {
    placed.push(...nodesOf(content, [...segments, slot]));
  }
  return placed;
}

function nodesOf(content: Content, segments: readonly PathSegment[]): PlacedNode[] {
  const list: readonly ContentNode[] = Array.isArray(content) ? content : [content as ContentNode];
  const at = (index: number) => (Array.isArray(content) ? [...segments, index] : segments);
  return list.flatMap((node, index) => {
    const here = { node, segments: at(index) };
    return typeof node === "object" && "component" in node
      ? [here, ...slotNodes(node.slots, [...here.segments, "slots"])]
      : [here];
  });
}

/** Every content node of every fixture: its slots', then each part instance's. */
export function contentNodes(spec: Spec): PlacedNode[] {
  return Object.entries(spec.fixtures ?? {}).flatMap(([name, fixture]) => [
    ...slotNodes(fixture.slots, ["fixtures", name, "slots"]),
    ...Object.entries(fixture.parts ?? {}).flatMap(([part, instances]) =>
      instances.flatMap((instance, index) =>
        slotNodes(instance.slots, ["fixtures", name, "parts", part, index, "slots"]),
      ),
    ),
  ]);
}

/** A member path, `<kind>.<name>` or `parts.<Part>.<kind>.<name>`, split; undefined when it has neither form. */
export function parseMemberPath(
  path: string,
): { readonly part?: ComponentName; readonly kind: MemberKind; readonly name: MemberName } | undefined {
  const segments = path.split(".");
  const kinds: readonly string[] = ["props", "events", "slots", "methods"];
  if (segments.length === 2 && kinds.includes(segments[0] ?? "")) {
    return { kind: segments[0] as MemberKind, name: segments[1] ?? "" };
  }
  if (segments.length === 4 && segments[0] === "parts" && kinds.includes(segments[2] ?? "")) {
    return { part: segments[1] ?? "", kind: segments[2] as MemberKind, name: segments[3] ?? "" };
  }
  return undefined;
}

/** The props `extensions.<adapter>.add` adds, with where each is in the front matter. */
export function extensionProps(spec: Spec): { segments: PathSegment[]; prop: Prop; name: string }[] {
  const props: { segments: PathSegment[]; prop: Prop; name: string }[] = [];
  for (const [adapter, extension] of Object.entries(spec.extensions ?? {})) {
    for (const [path, member] of Object.entries(extension.add ?? {})) {
      if (parseMemberPath(path)?.kind === "props") {
        props.push({ segments: ["extensions", adapter, "add", path], prop: member as Prop, name: path });
      }
    }
  }
  return props;
}

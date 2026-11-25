// SPDX-License-Identifier: GPL-3.0-or-later
import type { Fixture, KebabName, Spec } from "../spec/types.js";
import { MatrixError } from "./error.js";
import type { ManifestFixture } from "./types.js";

/**
 * A fixture with its `extends` chain merged (docs/spec/spec-format.md#fixtures): props and slots
 * merge by name, a part's list replaces the base's list, and a frame replaces the base's frame.
 * The result has no `extends` or `description`, and shares no objects with the spec.
 */
export function resolveFixture(spec: Spec, name: KebabName): ManifestFixture {
  return resolve(spec.fixtures ?? {}, name, []);
}

function resolve(
  fixtures: Readonly<Record<KebabName, Fixture>>,
  name: KebabName,
  chain: readonly KebabName[],
): ManifestFixture {
  const fixture = Object.hasOwn(fixtures, name) ? fixtures[name] : undefined;
  if (fixture === undefined) {
    const from = chain.at(-1);
    throw new MatrixError(
      "SPEC-009",
      from === undefined ? ["fixtures"] : ["fixtures", from, "extends"],
      from === undefined
        ? `there is no fixture '${name}'`
        : `the fixture '${from}' extends '${name}', which doesn't exist`,
    );
  }
  if (chain.includes(name)) {
    throw new MatrixError(
      "SPEC-009",
      ["fixtures", name, "extends"],
      `the fixtures extend each other in a cycle: ${[...chain, name].join(" → ")}`,
    );
  }
  const base: ManifestFixture =
    fixture.extends === undefined ? {} : resolve(fixtures, fixture.extends, [...chain, name]);

  const props = { ...base.props, ...fixture.props };
  const slots = { ...base.slots, ...fixture.slots };
  const parts = { ...base.parts, ...fixture.parts };
  const frame = fixture.frame ?? base.frame;
  return structuredClone({
    ...(Object.keys(props).length > 0 ? { props } : {}),
    ...(Object.keys(slots).length > 0 ? { slots } : {}),
    ...(Object.keys(parts).length > 0 ? { parts } : {}),
    ...(frame === undefined ? {} : { frame }),
  });
}

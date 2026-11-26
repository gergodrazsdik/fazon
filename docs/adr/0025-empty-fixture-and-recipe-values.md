# 0025: The empty fixture refused by generate, recipe values type-checked

- Status: accepted
- Date: 2026-11-26
- Tracker: Q-0025, Q-0026

## Context and problem statement

Implementing SPEC-003 to SPEC-018 ([#76](https://github.com/gergodrazsdik/fazon/pull/76)) raised two questions.

1. **The empty fixture.** The story matrix rules said a spec with no fixtures renders an empty fixture, "which SPEC-009 allows only when no prop or slot is required". But fixtures are written after `fazon approve`: the propose prompt and the spec skill leave them for later, because they build on the approved API. Enforcing the clause in `spec check` would make `fazon propose` reject every API with a required prop or slot, and `fazon approve` refuse every spec without fixtures; Badge, Link, Dialog and Button all have a required `default` slot.
2. **Recipe values.** SPEC-016 required a recipe's props to exist, but not their values to fit the prop's type, while SPEC-009 checks both for fixtures. A recipe that sets an enum prop to a value it doesn't have passed `spec check` and failed only when the story rendered.

## Considered options

For the empty fixture:

1. Enforce it in `fazon generate` and `fazon feedback`, where stories are first rendered.
2. Write fixtures before `fazon approve`, and keep the clause in `spec check`.
3. Drop the clause.

For recipe values:

1. Check that a recipe's prop values fit their types.
2. Leave SPEC-016 as it is.

## Decision outcome

The maintainer chose **enforcing the empty-fixture clause in generate** and **checking recipe values**.

- `spec check` allows a spec without fixtures. `fazon generate` and `fazon feedback` refuse (2) a spec that has no fixtures while its component has a required prop or slot, after the spec's findings and before the run lock, with a hint to add fixtures first. The approved API's hash covers only the API fields, so adding fixtures needs no new `fazon approve`.
- SPEC-016 requires a recipe's prop values to be of their prop's type, as SPEC-009 does for a fixture's; both rules share the code.

### Consequences

- The order propose, approve, then fixtures stays as the spec skill describes it; a spec reaches `generate` only once its fixtures can render it.
- story-matrix.md, spec-format.md (SPEC-009's note and SPEC-016's row) and cli.md (the `generate` and `feedback` refusals) say so.
- A recipe value of the wrong type is a `spec check` finding instead of a rendering failure.

## More information

- [Story matrix rules: fixtures](../spec/story-matrix.md#fixtures), [spec format: validation](../spec/spec-format.md#validation), [CLI: `fazon generate`](../spec/cli.md#fazon-generate)

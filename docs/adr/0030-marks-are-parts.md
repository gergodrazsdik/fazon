# 0030: A mark that shows a state is a composed part, not a pseudo-element

- Status: accepted
- Date: 2026-11-28
- Tracker: Q-0032, T-0060

## Context and problem statement

Since [#107](https://github.com/gergodrazsdik/fazon/pull/107), the `tokens` check reads the values of `::before`, `::after` and the other pseudo-elements that render. But a spec's token rules and reflected states apply to elements with `data-part`, and a pseudo-element has no `data-part`. A Checkbox tick or a Switch thumb drawn with `::before` would get no per-state `token-rule`, and MATRIX-005 couldn't check that its state is reflected (Q-0032).

In the spec format, a part is a piece the consumer composes: it renders in its parent's default slot, and a fixture lists its instances.

## Considered options

1. Marks are elements with `data-part`: parts in the spec, which the consumer composes, as Reka UI's `CheckboxIndicator` and `SwitchThumb` are.
2. The same, with a new kind of part that the parent renders itself and that isn't in the consumer's API: a spec-format change.
3. Token rules get a pseudo-element field, and the checks that read states follow pseudo-elements.

## Decision outcome

The maintainer chose option 1. No spec-format or check changes.

### Consequences

- The conventions doc gains a rule: a mark that shows a state or takes its own token, such as a checkbox's tick, a radio's dot or a switch's thumb, is an element with `data-part`, a part in the spec. Pseudo-elements are for decoration that carries no state; `tokens` still checks their values.
- Checkbox's API becomes `<Checkbox><CheckboxIndicator /></Checkbox>`, and Switch's `<Switch><SwitchThumb /></Switch>`, the shape Reka UI's own Checkbox and Switch have. The spec skill suggests such a part to the developer, who decides.
- Option 2 can follow later, if composing the marks proves a burden for consumers.

## More information

- [Conventions: parts and states](../spec/example-library/conventions.md#parts-and-states), [spec format: parts](../spec/spec-format.md#parts), [check catalogue: tokens](../spec/check-catalogue.md#tokens)
- [ADR 0029](0029-m4-plan.md)

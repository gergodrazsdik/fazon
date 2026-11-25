# 0005: Spec format: a neutral API with framework extensions, one spec per component

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0020, Q-0005, Q-0006

## Context and problem statement

The [spec format](../spec/spec-format.md) is the first M0 document, and most of the others build on it. The brief left two questions open for it: whether the API in a spec is framework-neutral or written per framework (Q-0005), and whether a multi-part component such as Tabs or Dialog has one spec or several (Q-0006). Writing the format raised three more: whether props may be written in a short form, where the approval of the API is recorded, and whether a spec may say which token a variant uses.

## Considered options

- **The API (Q-0005):** neutral, mapped by each adapter; written per framework; neutral with framework-specific extensions.
- **Multi-part components (Q-0006):** one spec with named parts; one spec per part, grouped into a family. The maintainer decided from a worked Tabs example of both.
- **Prop notation:** a short form (`variant: [primary, secondary]`, `disabled: boolean`) alongside the long form; the long form only.
- **Approval:** an `approved` field with the API's hash in the spec; the hash in the component's provenance file.
- **Tokens:** no token field, with the mapping in the conventions doc as prose; an optional, partial list of token rules; a third layer of component tokens.

## Decision outcome

- **A neutral API with extensions.** The API is framework-neutral wherever it maps cleanly. What doesn't map goes into an `extensions` block per adapter, keyed by adapter ID, with four operations: `options` (component-level settings), `map` (how an existing member maps), `add` (a member only that framework has) and `omit` (a member it can't offer). The block's `reason` is optional, as it is usually the same for a whole framework. The core validates the structure and the member paths; each adapter validates its own `options` and `map` values. To keep extensions rare, three concerns that every framework shares but implements differently are part of the neutral API: `methods`, `forward` (which element receives undeclared attributes and the ref) and `form` (form participation). Rules that hold for every component of one framework belong in the adapter's defaults or the config file, not in specs.
- **One spec with named parts.** A multi-part component is one spec. Its `parts` each name a `parent` and a `count`, and carry their own API, states and accessibility. One spec keeps one generation run, one approval, one story matrix and one provenance record per component, and gives behaviour that spans parts a single place. Reuse across components comes from `uses`, which composes other components' specs.
- **Long form only.** Every prop, event, slot and method is a mapping with explicit fields. One notation is simpler to read, validate and generate than two.
- **Approval in the provenance file.** The hash of the approved API is recorded in the component's provenance file (T-0028), not in the spec, which keeps the spec a file people write.
- **Optional token rules.** A spec may list rules that tie a property to a role token for a variant or state. The token check is exact where a rule exists and falls back to "any role token" elsewhere. Component tokens were not chosen: they would change the brief's two-layer token model.

### Consequences

- The adapter boundary (T-0031) defines each adapter's mapping of the neutral API and its schema for `extensions`.
- `fazon spec check` needs the token set to check token rules, and the check catalogue to check exemptions.
- A story for a part always renders the whole component, because the matrix is built per spec.
- In version 0 a `many` part can't hold another `many` part (F-0006); Select may need it.
- The format is version 0 and may change in any pull request until Fazon 1.0; a change that alters these decisions supersedes this ADR.

## More information

- Spec format: [docs/spec/spec-format.md](../spec/spec-format.md)
- Brief: [Component spec](../design/brief.md#component-spec), [Framework adapters](../design/brief.md#framework-adapters)

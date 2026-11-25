# 0018: Token set: a DTCG resolver, role tokens by structure, a configurable prefix, a bundled font

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0033, Q-0007

## Context and problem statement

The brief keeps tokens in the DTCG format, built with Style Dictionary into CSS custom properties. Raw tokens hold values, role tokens point at them, and a theme is a modifier that re-points role tokens. It asks M0 to:

- pin the part of the format the build supports (Q-0007);
- draft a small neutral token set for the maintainer to approve once;
- write the conventions doc, deciding which of its rules become machine-checkable.

ADR 0006 and ADR 0007 add three more questions: how role tokens are told apart, how custom properties are named, and what the story frame's base styles are.

Style Dictionary 5.8.0 builds the 2025.10 format's object colours, dimensions, durations, cubic Béziers, font families and shadows, but doesn't read the 2025.10 resolver module, where themes are declared.

## Considered options

1. **Themes:** a DTCG resolver document that Fazon resolves itself; one file with dark values in `$extensions`; plain files mapped to themes in `fazon.yaml`.
2. **Role tokens:** by structure (a value that is a single reference); by set; an explicit `$extensions` marker.
3. **Custom property names:** the path with no prefix; a fixed `fz-` prefix; a prefix set in `fazon.yaml`.
4. **Font:** Inter, bundled by the library; the system font stack.
5. **Accent colour:** blue, violet, teal, near-black.
6. **Dark theme switch:** the `data-theme` attribute only; the attribute or `prefers-color-scheme`.
7. **Enforced conventions:** only rules an existing check already measures; a new conventions lint.

## Decision outcome

The maintainer chose:

1. **A DTCG resolver.** `paths.tokens` names `tokens/tokens.resolver.json`, with raw, role and per-theme files. The tokens pipeline resolves each theme and runs Style Dictionary once per theme; native support can replace that later.
2. **By structure.** A token whose value is a single reference is a role token, one with a literal value is raw. Nothing extra to mark, and the build checks it.
3. **A prefix in config,** `tokens.prefix`, empty by default. The example library uses `fz`.
4. **Inter, bundled** from `@fontsource-variable/inter`, so the verifier, laptops and apps render the same glyphs.
5. **Blue,** with cool greys and red, green and amber for status.
6. **The attribute only.** `data-theme="dark"` on an ancestor; an app that wants to follow the OS sets it itself.
7. **Only existing checks.** The conventions doc marks each rule as enforced, naming the check, or as guidance for the agent, the judge's `family` question and the reviewer.

The format subset (Q-0007) is what Style Dictionary 5.8.0 built in a trial of the draft token set: sRGB colours with hex, `px` and `rem` dimensions, `ms` durations, cubic Béziers, font families, numeric weights, numbers, and shadows. Composite types other than shadows, JSON pointer references and other modifiers wait until a component needs them.

### Consequences

- The trial showed that a role token with a raw token's path replaces it when the sets merge and references itself; TOKEN-004 forbids it.
- `fazon sync` also builds the token CSS, at `paths.tokensCss` (`src/tokens.css`), and the `build` check's rule `generated` covers it.
- `fazon.yaml` gains `tokens.prefix` and `paths.tokensCss`; `paths.tokens` now names the resolver document.
- Fonts in captures are the library's bundled fonts, not only the verifier image's; the story matrix rules say so.
- Inter's license notice joins Lucide's in the license terms (T-0034).
- The check fixtures use the draft's token names with no prefix, the default.

## More information

- Token set: [docs/spec/tokens.md](../spec/tokens.md)
- The drafts: [docs/spec/example-library/](../spec/example-library/README.md)
- Brief: [Tokens](../design/brief.md#tokens), [Conventions doc](../design/brief.md#conventions-doc)
- [DTCG format 2025.10](https://www.designtokens.org/tr/2025.10/format/), [resolver module](https://www.designtokens.org/tr/2025.10/resolver/)

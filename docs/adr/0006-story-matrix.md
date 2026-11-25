# 0006: Story matrix: layered grids, real input, stable names

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0021

## Context and problem statement

The harness generates a component's stories from its spec ([spec format](../spec/spec-format.md)), so the agent doesn't choose what gets verified. The brief leaves to the [story matrix rules](../spec/story-matrix.md) which props span the matrix, how combinations are pruned, how each state is produced, what a story renders, how much of the matrix runs in each theme, and how stories are named so baseline names stay stable. The answers decide how many screenshots, baselines and judge crops each component costs.

## Considered options

1. **Expansion:** layered grids (axes, states, fixtures); the full product; pairwise (all-pairs) combinations.
2. **Pseudo-states:** real input from Playwright in the verifier; Storybook's pseudo-states addon.
3. **Themes:** every check and baseline in every theme with the judge on the axes grid outside the default theme; only the axes grid outside the default theme; everything in every theme.
4. **Finding parts:** a `data-part` attribute; the role and accessible name from the spec.
5. **Names:** every axis in every name; axes at their default left out.
6. **Fixture icons:** a small set drawn for Fazon; Lucide; icons the consumer supplies.
7. **Overflow:** a frame width on a fixture; one fixed frame; width as a matrix axis.

## Decision outcome

The maintainer chose:

1. **Layered grids.** Every axis combination in the default state; every state against the first axis's values; every other fixture at the defaults. Every value, state and fixture is seen at least once, and the count grows additively: Button has 26 stories per theme instead of 162.
2. **Real input.** The verifier hovers, focuses with the keyboard and holds the pointer down, as a user would, which also covers state driven by JavaScript. Storybook's own UI shows such stories in their default look; the report shows every state.
3. **Every check and baseline in every theme; the judge sees the axes grid outside the default theme.** Rendering and deterministic checks are cheap; judge calls cost.
4. **`data-part` attributes,** on the component's root and each part's root, together with `data-<state>` attributes for every state that isn't a pseudo-state. They locate targets independently of content, and tell the verifier each element's state.
5. **Every axis in every name,** in the order of `matrix.axes`. Names don't depend on defaults; adding an axis renames the component's stories, and the baseline lifecycle handles it.
6. **Lucide** (`lucide-static`, ISC license), which a consumer can replace through the config file.
7. **A frame width on a fixture** (`frame.width`), so a long-label fixture tests wrapping and clipping in a narrow container.

The rules also add to the spec format: `produce` recipes for states the rules can't infer (including `story: false` for states the fixtures already show), `frame` on a fixture, and `matrix.exclude` conditions that can name part props and a part's state.

### Consequences

- The conventions doc (T-0033) requires the `data-part` and `data-<state>` attributes; the verifier enforces them (MATRIX-004, MATRIX-005).
- The license terms (T-0034) cover Lucide's license notice, and the framework pins a `lucide-static` version from M1.
- The config file (T-0029) has a key for a consumer's own icon set.
- The verifier's tests in M1 confirm that the `focus` action makes `:focus-visible` match in the pinned browser.
- A state combined with a non-default value of a second axis, or two states at once, is only covered where a fixture shows it.

## More information

- Story matrix rules: [docs/spec/story-matrix.md](../spec/story-matrix.md)
- Brief: [Story matrix](../design/brief.md#story-matrix), [Themes](../design/brief.md#themes)

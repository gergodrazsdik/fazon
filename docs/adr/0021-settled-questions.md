# 0021: Token CSS in the package, no headers in the example repository, a minimum Claude Code version, a measurement budget, paragraph nodes, generated themes

- Status: accepted
- Date: 2026-11-27
- Tracker: Q-0010, Q-0011, Q-0019, Q-0020, F-0009, F-0011

## Context and problem statement

Four questions were open after M0 and the first M1 steps, and two choices that the code made where the specs were silent needed the maintainer:

- Q-0011: does the example library's token CSS ship inside the component package or as a package of its own?
- Q-0020: do the example repository's own files carry a license header?
- Q-0019: which Claude Code version does `fazon doctor` require?
- Q-0010: what is the budget for measured API runs?
- F-0009: a fixture's list of strings renders as adjacent text, so Dialog's paragraphs run together.
- F-0011: `.storybook/preview.ts` lists the token set's themes by hand, so a new theme can leave Storybook behind unseen.

## Considered options

1. **Token CSS:** inside the component package; a package of its own.
2. **Headers in the example repository:** none; an `SPDX-License-Identifier: MIT-0` line in every hand-written source file.
3. **Claude Code version:** a minimum per framework version; an exact version; no requirement.
4. **Budget:** USD 300 through M3; USD 150 through M3; an approval per round.
5. **Block text in fixtures:** a paragraph content node; lists of strings become paragraphs; strings joined with a space.
6. **Themes in Storybook:** `fazon sync` generates them; the preview reads the token set when Storybook builds.

## Decision outcome

The maintainer chose:

1. **Inside the component package.** The library exports its token CSS beside its components, so tokens and components can't drift apart in versions.
2. **No headers.** The repository's MIT-0 license covers every file. Files Fazon writes carry none, so hand-written files match them. The scripts copied from the framework lose their `MIT-0` lines.
3. **A minimum version per framework version,** set in M2 from the Claude Code the harness is built and tested against, and raised on purpose. `propose`, `generate` and `feedback` refuse to start with an older Claude Code; `doctor` reports it, and warns rather than fails, as CI's `verify` job doesn't run the agent.
4. **USD 150 through M3,** for M2's first measurement round and M3's first calibration round together. A round whose estimate exceeds what's left waits for the maintainer's approval. M4's budget is set before its round.
5. **A paragraph node,** `{ p: "text" }`, which renders as a `<p>`; plain strings stay inline text, such as a button's label.
6. **`fazon sync` generates them** into a module the Storybook preview imports, and `sync --check` catches drift like any other generated file.

### Consequences

- tokens.md, licensing.md, cli.md and measurement.md say so; the spec format and the Vue adapter gain the paragraph node, and the adapter and sync the generated themes module, each in its own pull request.
- T-0094 implements the Claude Code check with M2's agent commands.
- The tighter budget makes M2's runs cheap by design: the default caps stay, and a round is estimated before it starts.

## More information

- [Token set](../spec/tokens.md#the-build), [license terms](../spec/licensing.md#the-example-repository), [CLI reference](../spec/cli.md#fazon-doctor), [measurement protocol](../spec/measurement.md#measured-runs)

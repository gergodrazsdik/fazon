# 0023: Skills from the pinned framework commit, Claude Code 2.1.332 as the minimum

- Status: accepted
- Date: 2026-11-26
- Tracker: T-0050, T-0094

## Context and problem statement

M2 brings the first skills (the spec skill and the generation skill) and the first agent commands. Two choices had to be made before its steps start:

- The brief puts the skills in a Claude Code plugin in `plugin/`, but the plugin is packaged and released only in M5 (T-0065). Until then, how does the example repository load them?
- [ADR 0021](0021-settled-questions.md) sets a minimum Claude Code version per framework version, chosen in M2 from the version the harness is built and tested against. Which one?

## Considered options

1. **Skills before M5:** load `plugin/` from the framework commit the example repository already builds from source ([ADR 0022](0022-build-from-source-and-component-names.md)); copy the skills into the example repository; wait for M5.
2. **Minimum Claude Code version:** the version installed when M2 starts; a later one picked when M2 ends.

## Decision outcome

The maintainer chose:

1. **The pinned commit's `plugin/`.** The example repository's `just claude` passes `--plugin-dir` with the plugin in `.fazon-framework/<sha>/plugin`, so the skills come from the same commit as the CLI and adapter, and move with the pin. Nothing is copied or published.
2. **Claude Code 2.1.332,** the version installed when M2 started, once the agent call's tests pass against it. It's raised on purpose, in its own pull request.

### Consequences

- `plugin/` arrives with T-0050's step 1, and the layout in AGENTS.md lists it.
- The example repository's `just claude` recipe gains the `--plugin-dir` flag when the first skill lands.
- T-0094 checks the version in `propose`, `generate` and `feedback`, and `doctor` reports it.
- From M5, the released plugin replaces the directory, as for the packages.

## More information

- [The brief's framework repo layout](../design/brief.md#framework-repo-layout), [CLI reference](../spec/cli.md#fazon-doctor)

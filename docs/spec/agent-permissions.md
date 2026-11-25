# Agent permission model

What the agent may read, write and run while it generates a component, what the harness writes instead, and how the harness enforces it. The agent edits files; the harness decides everything else ([brief](../design/brief.md#what-the-agent-sees-and-may-touch)). Decisions behind it: [ADR 0009](../adr/0009-agent-permissions.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0024.

## Scope

| What | Defined in |
|---|---|
| Iterations, caps and what ends a run | [Loop and caps](loop-and-caps.md) |
| How hand edits and violations are recorded | [Run records and provenance](records.md) |
| The components directory and other paths | [Config file reference](config.md) |
| The adapter's file patterns and self-check commands | [Adapter boundary](adapter-boundary.md) |

## How it's enforced

Three layers, each enough on its own for what it covers:

1. **Claude Code's permission rules** for the headless call: which files the agent may edit, which commands it may run, and which tools exist at all. The harness writes them for each run.
2. **Claude Code's sandbox** for the commands the agent runs: writes only inside the component's directory and temporary directories, and no network.
3. **The harness's own check after every call,** which is the one that counts: it compares every file outside the allowed paths with the state before the call, and fails the run on any difference ([PERM-002](#rules)). The sandbox limits shell commands, not file edits, so this check is what makes the allowed paths hold.

## Paths

A component's directory is `<components>/<name>/`, where `<components>` comes from the config file (default `src/components/`) and `<name>` is the component name in kebab-case.

| Path | The agent | Written by |
|---|---|---|
| `<components>/<name>/**`, except `generated/` | reads and writes, files of the patterns the adapter allows | the agent |
| `<components>/<name>/generated/**`: story files, contract tests, the story manifest | reads | the harness, from the spec |
| Other components' directories, and any other source file | reads | the agent of that component, or a person |
| The package entry file | reads | the harness |
| `specs/`, the tokens file, the conventions doc, the config file | reads | a person; the harness writes a proposed API into a spec during [`fazon propose`](cli.md#fazon-propose) |
| `baselines/` | reads | `fazon baseline update`, run by a person |
| `package.json`, the lockfile, and the lint, TypeScript, Storybook and test configuration | reads | a person |
| `.github/`, `.claude/`, `.fazon/` | no access | a person; `.fazon/` by the harness |
| `.env*`, keys and certificates | no access | a person |

The agent never changes dependencies: package files aren't writable and its shell has no network. A component that needs a new dependency, or a change to shared code, ends as "needs a person" with a finding that says so.

## What the agent receives

Each call's prompt carries:

- the spec and its approved API, with the adapter's mapping applied;
- the role tokens and the conventions doc;
- the findings of the previous iteration, without the visual diffs that are advisory in a generate run ([baseline lifecycle](baseline-lifecycle.md#the-visual-check-by-context));
- the developer's review feedback, if any;
- the iteration number and the caps left.

It may read other files of the repository to stay consistent with existing components.

## What the agent may run

Exactly the adapter's self-check commands, scoped to its component: type-check, lint and the component's tests. For the Vue adapter they could be:

```text
pnpm exec vue-tsc --noEmit
pnpm exec eslint src/components/button
pnpm exec stylelint "src/components/button/**/*.{vue,css}"
pnpm exec vitest run src/components/button
```

The [adapter boundary](adapter-boundary.md#commands) fixes the exact commands. They run on the host, inside the sandbox, using the dependencies the developer installed. Their results are advisory: the harness runs every check in the verifier image after the call, and only those results count. No other command is allowed: no package manager install, no git, no network tools.

## The headless call

One `claude -p` call per iteration, with settings the harness generates for the run:

- edits allowed only in the component's directory, outside `generated/`, for the adapter's file patterns;
- reads denied for `.env*`, keys, certificates, `.github/`, `.claude/` and `.fazon/`;
- Bash allowed only for the self-check commands;
- no web fetch or web search, no MCP servers, no subagents;
- the sandbox on, with no network and writes limited as above;
- non-interactive: what the rules don't allow is denied, never prompted;
- the model the loop chooses ([escalation](loop-and-caps.md#escalation)).

An illustrative excerpt, for Button:

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Edit(src/components/button/*.vue)",
      "Edit(src/components/button/*.ts)",
      "Bash(pnpm exec vue-tsc --noEmit)",
      "Bash(pnpm exec eslint src/components/button)"
    ],
    "deny": [
      "Edit(src/components/button/generated/**)",
      "Read(.env*)",
      "WebFetch",
      "WebSearch"
    ]
  },
  "sandbox": { "enabled": true }
}
```

The exact keys and flags follow the Claude Code version the harness requires; M2 confirms them, and the run record stores the version used.

## Files the harness maintains

- **Generated files:** at the start of each run, the harness regenerates the component's `generated/` directory from the spec: the story files and contract tests (written by the adapter) and the story manifest. They are committed with the component.
- **The package entry file:** when a component is first generated, the harness adds exports for it and its parts.
- **[Provenance and run records](records.md).**

CI regenerates the generated files from the committed specs and fails when they differ from the committed ones (the `build` check's rule `generated`).

## Hand edits

During a run, the harness takes a snapshot before and after each agent call:

- A change made **during** a call, outside the allowed paths, is a violation: the run ends as "needs a person", and the report lists the files. The harness doesn't revert them, so a person can see what happened.
- A change made **between** calls is a person's hand edit, wherever it is. The run record stores each one, with its files; it counts as a human intervention in the measurements.

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| PERM-001 | Every call runs with the permission rules and sandbox settings above. | the harness, when it starts the call |
| PERM-002 | After a call, no file outside the allowed paths differs from its state before the call. | the harness, after every call |
| PERM-003 | The component's directory holds only files of the adapter's patterns, outside `generated/`. | the harness, after every call |
| PERM-004 | The committed generated files are what the harness generates from the committed spec. | CI (`build` rule `generated`) |
| PERM-005 | Every change made between calls is recorded as a hand edit. | the harness |

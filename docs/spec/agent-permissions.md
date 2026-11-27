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
2. **Claude Code's sandbox** for the commands the agent runs: writes only inside the component's directory, the self-checks' cache directories and temporary directories, and no network.
3. **The harness's own check after every call,** which is the one that counts: it compares every file outside the allowed paths with the state before the call, and fails the run on any difference ([PERM-002](#rules)). The sandbox limits shell commands, not file edits, so this check is what makes the allowed paths hold.

## Paths

A component's directory is `<components>/<name>/`, where `<components>` comes from the config file (default `src/components/`) and `<name>` is the component name in kebab-case.

| Path | The agent | Written by |
|---|---|---|
| `<components>/<name>/**`, except `generated/` | reads and writes, files of the patterns the adapter allows | the agent |
| `<components>/<name>/generated/**`: story files, contract tests, the story manifest | reads | the harness, from the spec |
| Other components' directories, and any other source file | reads | the agent of that component, or a person |
| The package entry file | reads | the harness |
| `specs/`, the token set, the conventions doc, the config file | reads | a person; the harness writes a proposed API into a spec during [`fazon propose`](cli.md#fazon-propose) |
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

A propose call has no approved API, findings or feedback yet: its prompt carries the spec, the adapter's API mapping, the role tokens, the conventions doc and the caps left ([a propose call](#a-propose-call)).

It may read other files of the repository to stay consistent with existing components.

The prompt starts with the instructions of the generation skill, `plugin/skills/generate/SKILL.md` in the framework (which `@fazon/core` carries as `dist/skills/generate/SKILL.md`, so it is found wherever the package is installed), without its front matter, and the component's files, the patterns the agent may write and the self-check commands. What stays the same for the run (the skill, the files, the spec, the approved API, the role tokens and the conventions doc) comes first, then the feedback, the findings and the iteration. Details:

- **The approved API** is the adapter's data files in `generated/` after the refresh at the run's start (`api.json` for Vue): the API with the mapping applied, as the contract tests compare it.
- **The role tokens** are each role token's custom property, path and type; never a resolved value.
- **The findings** are the blocking findings of the latest iteration whose checks ran, the first 50 in full and the rest counted by check and rule, with the checks that ended in error or were skipped, and how the previous call ended when it didn't complete.
- **Every included file** is in a fenced block whose fence is longer than any run of backticks in it.

The skill reaches the call in its prompt, not as a plugin (`--plugin-dir`): the call's `--tools` list has no Skill tool, every call has to follow the instructions rather than leave it to the model to load them, and a plugin would add its commands, agents, hooks and MCP servers to a call whose tools and settings PERM-001 fixes. A developer's interactive session loads the same `plugin/` with `--plugin-dir` for the spec skill ([ADR 0023](../adr/0023-m2-skills-and-claude-code-version.md)).

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

The exact keys and flags follow the Claude Code version the harness requires, and the run record stores the version used. For the minimum, 2.1.332 (ADR 0023), they are:

| What | How |
|---|---|
| Settings | `--settings .fazon/runs/<run>/calls/<n>.settings.json`, with `--restricted` so that only managed settings and this file apply, not the user's or the repository's |
| Edits | `permissions.allow`: `Edit(./<components>/<name>/<pattern>)` for each of the adapter's patterns; `permissions.deny`: `Edit(./<components>/<name>/generated/**)`. Edit rules cover the Write tool too |
| Reads | `Read`, `Glob` and `Grep` allowed; `Read(./.github/**)`, `Read(./.claude/**)`, `Read(./.fazon/**)` and, at any depth, `Read(.env*)`, `Read(*.pem)`, `Read(*.key)` and the other key and certificate names denied |
| Commands | `Bash(<command>)` for each self-check command, matching exactly that command |
| Tools | `--tools Read,Glob,Grep,Edit,Write,Bash`; `--disallowed-tools WebFetch,WebSearch,Agent,Task,NotebookEdit,mcp__*` |
| MCP | `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, and `disableClaudeAiConnectors`; hooks off (`disableAllHooks`) |
| Non-interactive | `--permission-mode dontAsk` (also `permissions.defaultMode`), `--permission-prompts none`, and `permissions.disableBypassPermissionsMode: "disable"` |
| Sandbox | `sandbox.enabled`, `failIfUnavailable` (no call without it), `autoAllowBashIfSandboxed: false`, `allowUnsandboxedCommands: false`, `network.allowedDomains: []`; `filesystem.allowWrite` the component's directory and the adapter's cache directories; `filesystem.denyWrite` `generated/` and every path that exists when the call starts beside those directories and their parents (the repository's other top-level entries, the other entries of `src/` and `src/components/`, every package and pnpm's own entries in `node_modules/`), but not the repository as a whole: sandboxed commands may write in the working directory by default, and on Linux a denied directory stays denied below it, even where `allowWrite` names a narrower path. A path that doesn't exist yet can't be denied: the snapshots catch a file a command creates there unless git ignores it (PERM-002). `filesystem.denyRead` the three directories above and each secret file found in the repository by path, as the sandbox on Linux ignores glob patterns |
| Model and limits | `--model`, `--effort` when the config sets one, and `--max-budget-usd` with what remains of the run's budget |
| Output | `--print --output-format stream-json --verbose`, written to `calls/<n>.jsonl` as the transcript; `--no-session-persistence` |
| Prompt | on standard input, which is then closed |

The harness checks Claude Code's first event: a call that lists a denied tool or an MCP server, or doesn't run in `dontAsk` mode, is stopped and ends in error (PERM-001). Read-only shell commands that Claude Code runs without asking still run, inside the sandbox.

### A propose call

The one call of a [propose run](loop-and-caps.md#runs) may change no file and run no command: the harness, not the agent, writes the proposed API into the spec. Its settings differ from a generate call's:

| What | How |
|---|---|
| Tools | `--tools Read,Glob,Grep`: no Edit, Write or Bash |
| Permissions | `permissions.allow` only `Read`, `Glob` and `Grep`; `permissions.deny` adds `Edit` and `Bash` to the rules above |
| Sandbox | as above, with an empty `filesystem.allowWrite` and `filesystem.denyWrite` the repository as a whole |
| Answer | `--json-schema` with the schema of a proposed API: the spec schema's API fields, with no `states`, `produce` or `a11y` on a part. Claude Code compiles it as draft-07 in strict mode, so it gets a draft-07 copy: without `$schema` and `unevaluatedProperties`, with `$defs` as `definitions` and `dependentRequired` as `dependencies`; the harness validates the answer against the full schema. Claude Code returns the answer as the result's structured output; without one, the harness reads the JSON object in the final message |
| Allowed paths | none: any file that changes during the call is a violation (PERM-002) |

Its prompt carries the spec, the adapter's API mapping, the role tokens, the conventions doc and the caps left, and says how to answer.

## Files the harness maintains

- **Generated files:** at the start of each run, the harness regenerates the component's `generated/` directory from the spec: the story files and contract tests (written by the adapter) and the story manifest. Until the component's root file exists, only the story manifest and API (see the entry file below). They are committed with the component.
- **The refresh during a run:** a generate or feedback run refreshes the component's `generated/` directory and the entry file's exports with `fazon sync`'s code at its start, and again before each check phase, as the call before it may have written the component's root file, which the story files, contract tests and export wait for. It writes nothing else `fazon sync` maintains: other components' generated files, the token CSS and the Storybook themes stay a person's to sync, and the `build` check's rule `generated` reports them when they're stale. The files the refresh writes are the harness's, not hand edits (PERM-005).
- **The package entry file:** `fazon sync` exports a component and its parts once the component's root file exists, such as `Button.vue`. Until then, sync writes only the component's story manifest and API, with no story files, contract tests or export, so the library and its checks build before the component is generated.
- **The token CSS:** `fazon sync` builds it from the token set ([the build](tokens.md#the-build)); the agent reads the role tokens, never this file's raw values.
- **The Storybook themes:** `fazon sync` writes the token set's themes and default theme into the module the Storybook preview imports them from (for Vue, `.storybook/generated/themes.ts`), so a theme added to the token set reaches the theme switch.
- **[Provenance and run records](records.md).**

CI regenerates the generated files from the committed specs and fails when they differ from the committed ones (the `build` check's rule `generated`).

## Hand edits

During a run, the harness takes a snapshot before and after each agent call. A snapshot covers every file git tracks or would track: tracked files, and untracked files that aren't ignored, outside `.fazon/` and, unless git tracks them, the paths Claude Code's sandbox mounts stubs over while it runs (`.claude/`, `.mcp.json`, `.vscode/`, `.idea/`, `.gitconfig`, `.gitmodules`, `.ripgreprc` and the shell startup files), which the agent can't write and which would otherwise read as hand edits; for each, its content's hash, its executable bit and, for a link, its target. Ignored files, such as `node_modules/` and build output, aren't covered.

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

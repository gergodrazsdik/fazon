# 0009: Agent permissions: one component directory, allowlisted self-checks, committed generated files

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0024

## Context and problem statement

The brief says the agent may change only its component's files, never baselines, tokens, checks or config, and that the harness enforces this itself, because Claude Code's sandbox limits shell commands but not file edits. The [agent permission model](../spec/agent-permissions.md) has to settle what else the agent may touch or run, where the files the harness generates live, and how a breach is detected.

## Considered options

1. **Generated story files and contract tests:** committed, with a drift check in CI; regenerated and gitignored.
2. **Commands the agent may run:** the adapter's type-check, lint and test commands on the host; none; one `fazon` wrapper that runs the source checks in the verifier image.
3. **Dependencies:** never changed by the agent; added from an allowlist in the config.
4. **Writable paths:** the component's directory only; that plus a shared folder.

## Decision outcome

The maintainer chose:

1. **Committed, with a drift check.** They live in the component's `generated/` directory, which the agent can read but not write. Reviewers see them change with the spec, Storybook builds without the CLI, and CI's `build` rule `generated` fails when they differ from what the spec generates.
2. **Allowlisted self-checks.** Exactly the adapter's type-check, lint and test commands for the component, on the host, in Claude Code's sandbox with no network. Their results are advisory; the harness's checks in the verifier image count.
3. **Never.** Package files aren't writable and the agent's shell has no network. A component that needs a dependency ends as "needs a person".
4. **The component's directory only.** Shared code is a person's; the agent may import it.

The model also sets: no web access, MCP servers or subagents for the agent; secrets, `.github/`, `.claude/` and `.fazon/` unreadable; the harness compares every file outside the allowed paths before and after each call, fails the run on a difference without reverting it, and records changes made between calls as hand edits.

### Consequences

- The adapter boundary (T-0031) lists the file patterns allowed in a component's directory and the exact self-check commands.
- The config file (T-0029) names the components directory.
- The developer installs dependencies and Playwright's browsers on the host for the self-checks to work.
- The exact Claude Code settings and flags are confirmed in M2 against the version the harness requires.

## More information

- Agent permission model: [docs/spec/agent-permissions.md](../spec/agent-permissions.md)
- Brief: [What the agent sees and may touch](../design/brief.md#what-the-agent-sees-and-may-touch)

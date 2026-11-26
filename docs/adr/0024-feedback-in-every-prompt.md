# 0024: The developer's feedback in every prompt of a feedback run

- Status: accepted
- Date: 2026-11-26
- Tracker: Q-0024

## Context and problem statement

A feedback run's agent calls share no session: each is a fresh `claude -p` call (`--no-session-persistence`). The specs disagreed on which calls see the developer's feedback: agent-permissions.md lists it in what each call's prompt carries, and loop-and-caps.md said only the first prompt carries it. `fazon feedback` ([#74](https://github.com/gergodrazsdik/fazon/pull/74)) followed loop-and-caps.md, so from the second iteration on the agent no longer saw what the developer asked for.

## Considered options

1. The feedback in every prompt of the run.
2. The feedback in the first prompt only.

## Decision outcome

The maintainer chose **every prompt**. A run that needs a second iteration keeps working towards the developer's feedback, not only towards the latest findings. The parent run's findings stay in the first prompt only: later prompts carry their own iteration's findings, as in a generate run.

### Consequences

- loop-and-caps.md and cli.md say so; agent-permissions.md already did.
- The prompts of a feedback run grow by the feedback's length.

## More information

- [Loop and caps: feedback](../spec/loop-and-caps.md#feedback), [agent permissions: what the agent receives](../spec/agent-permissions.md#what-the-agent-receives)

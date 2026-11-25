# 0010: Loop and caps: feedback as linked runs, $10 and 90 minutes per run

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0025

## Context and problem statement

The brief sets the shape of the loop: 5 iterations per component by default, a cost cap including judge calls, a wall-clock limit, escalation to the stronger model after 2 failed iterations, and "needs a person" when a cap is hit. It leaves to M0 what counts as an iteration, whether a review feedback round does, the default budget and time limit, and where each cap is enforced. The [loop and caps](../spec/loop-and-caps.md) document settles them.

## Considered options

1. **Feedback rounds:** a new run linked to the previous one, with fresh caps; part of the same run's 5 iterations; a new run whose budget is shared with the linked runs.
2. **Default budget per run:** $5; $10; $20. An estimate from current prices: about $1 per Sonnet 5.5 iteration, about $2 per Opus 5.5 iteration and about $0.10 of judge calls per iteration, so a 5-iteration run with escalation after 2 costs about $8.
3. **Default time limit per run:** 60, 90 or 120 minutes.
4. **How long escalation lasts:** the rest of the run; every later run of the component.

## Decision outcome

The maintainer chose:

1. **A new linked run,** with fresh iteration, budget and time caps. The measurements count linked runs together, and every feedback round as a human intervention.
2. **$10 per run,** covering a full run with escalation and the judge, with some headroom.
3. **90 minutes per run,** with a limit of 20 minutes on each agent call so one hung call can't use the whole run.
4. **The rest of the run.** A feedback run starts on the generator model again.

The document also defines an iteration as one agent call followed by the permission check, every check and the judge; makes caps checked before each call, with the remaining budget given to the call as its own limit; and counts visual diffs of the component being generated as advisory, and judge failures as blocking only after calibration.

### Consequences

- The config file (T-0029) holds the four caps, the two models, the escalation threshold, effort and the prices used for judge calls.
- The measurement protocol (T-0027) reports linked runs together and per-iteration models.
- A single call can overrun the budget when Claude Code can't stop it at its limit; the run record shows the overrun.
- M2 tunes the defaults from measured runs.

## More information

- Loop and caps: [docs/spec/loop-and-caps.md](../spec/loop-and-caps.md)
- Brief: [The loop](../design/brief.md#the-loop), [Caps and stop rules](../design/brief.md#caps-and-stop-rules), [Models, authentication and cost](../design/brief.md#models-authentication-and-cost)

# 0026: A feedback run records its feedback and the hand edits since its parent; the tokens check checks loaded fonts

- Status: accepted
- Date: 2026-11-27
- Tracker: Q-0023, F-0025, F-0016

## Context and problem statement

Three gaps came out of M2's runs in the example repository:

- **Q-0023:** a person often changes the component between runs, for example during the local review, before giving feedback. A run records hand edits only between its own calls (PERM-005), and `handEdits[].after` had to be at least 1, so the changes made before a feedback run's first call were recorded nowhere. The measurements count hand edits as human interventions, so they went missing.
- **F-0025:** a feedback run passes the developer's feedback to every prompt ([ADR 0024](0024-feedback-in-every-prompt.md)), but the run record kept only the parent run. The feedback survived only in the transcripts, which are local and can be deleted, and the report didn't show it.
- **F-0016:** the `tokens` rendered check compares each element's computed `font-family` with the token's value. A font that fails to load still computes to the token's family, and the browser renders a fallback, so a missing font passed the check.

## Considered options

Q-0023:

1. Record the changes since the parent run as a hand edit with `after: 0`.
2. Don't record them.

F-0025:

1. A run record field for the feedback.
2. The transcripts only.

F-0016:

1. Add a rule to the `tokens` check that the first font of every token family in use is loaded.
2. Leave it for M4.

## Decision outcome

The maintainer chose:

1. **Q-0023: record them as `after: 0`.** A feedback run records the changes made since its parent run's last call as `handEdits: [{ after: 0, files }]`, and they count as a human intervention in the measurements, as every hand edit does.
2. **F-0025: a record field.** The run record of a feedback run keeps the developer's feedback as `feedback: { text }`, and the HTML report shows it.
3. **F-0016: add the rule.** The `tokens` check gets a rule that every element whose `font-family` comes from a token has that family's first font loaded (`document.fonts`). A fallback is a blocking finding.

### Consequences

- **The baseline for `after: 0`:** after each agent call, the harness writes the component's files as the call left them to the run's directory, `component-files.json`: each file's fingerprint, as the snapshot takes it. A feedback run compares its parent's file with its own snapshot before its first call. The baseline is the parent's last call, not the parent's end, so a change made during the parent's last check phase counts too. The parent's last iteration's records (`checks/<n>/verify.json`) hold one hash of the component's inputs, which says whether something changed but not which files, so they can't be the baseline.
- **What counts:** only the component's files: its directory, outside `generated/`. The spec and the other inputs (token set, conventions doc, config) are inputs a person changes on purpose, not hand edits to the component: a spec change, such as a new story, is a change of what is asked for. Files the harness writes between runs don't count either: `fazon accept`'s provenance file and `fazon sync`'s generated files are under `generated/`, and `fazon baseline update`'s baselines, the entry file, the token CSS and the Storybook themes are outside the component's directory. The sandbox's stub paths are left out of every snapshot already.
- **A parent without the file** (a run before this change, or one that made no call) gives no baseline: nothing is recorded as `after: 0`, and `fazon feedback` says so.
- `handEdits[].after` may be 0, only in a feedback run. The provenance's `handEdits` counts these entries too.
- `feedback` is required in a feedback run's record and absent from every other; `parent` likewise.
- The F-0016 rule is implemented in its own pull request, with the check catalogue's entry for it.

## More information

- [Run records](../spec/records.md#the-run-record), [loop and caps: feedback](../spec/loop-and-caps.md#feedback), [agent permissions: hand edits](../spec/agent-permissions.md#hand-edits), [`fazon feedback`](../spec/cli.md#fazon-feedback), [`fazon report`](../spec/cli.md#fazon-report)
- [ADR 0024](0024-feedback-in-every-prompt.md): the feedback in every prompt

# 0011: Judge: a derived rubric, one call per question, $3 per CI run

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0026

## Context and problem statement

The brief fixes the judge's inputs (the spec, one labelled 2x crop per story, a diff image when a baseline exists, the reference image; never the code), its structured output (a verdict per story and findings with a severity), its isolation (a fresh context per call) and its authority (advisory until calibration meets the thresholds). It leaves to M0 how the rubric is built from a spec, how images are batched into calls, and the judge's cost cap in CI. The [judge](../spec/judge.md) document settles them.

## Considered options

1. **The rubric:** questions derived from the spec by fixed rules, plus questions a spec adds; derived questions only; no fixed questions, the judge reading the spec freely.
2. **Batching:** one call per question, with the images it needs side by side; one call per component; one call per story.
3. **The CI cost cap:** $1, $3 or $10 per workflow run.
4. **Repeats:** each call once, with calibration measuring stability; every call three times, by majority.

## Decision outcome

The maintainer chose:

1. **Derived questions, plus the spec's.** The harness derives questions from the spec and manifest:
   - every story on its own;
   - each axis, comparing its values;
   - each state against the default;
   - each `## Appearance` statement;
   - the reference image;
   - family consistency with other components;
   - each changed baseline.

   A spec adds its own through an optional `judge` field. Fixed questions make verdicts comparable across runs and calibration measurable.
2. **One call per question,** theme and batch of at most 20 images, so that a comparison sees its images side by side. The spec is a cached prefix, which keeps the extra calls cheap.
3. **$3 per CI run.** Stories left when it's spent are reported as not judged; the judge is advisory in CI by default.
4. **Once.** Calibration measures how often the judge agrees with itself; the repeat count is configurable, with majority voting.

The document also sets:

- **Severities:** `high`, `medium` and `low`.
- **No coordinates in findings,** because the model's localisation is approximate.
- **Combining verdicts:** a story fails if any call fails it.
- **A declined call or an API error** makes its images `unsure`.
- **A `judge` field** in the spec format (SPEC-018).

### Consequences

- The config file (T-0029) holds the judge's model, policy, CI cap, repeats and prices.
- The measurement protocol (T-0027) defines when a model counts as calibrated for a framework version, and measures stability and cost.
- The reusable workflow (T-0032) runs the judge step with its secret, skips forks and enforces the cap.
- A component's judge pass makes more calls than one call per component would. Each call is small, and the spec prefix is cached.

## More information

- Judge: [docs/spec/judge.md](../spec/judge.md)
- Brief: [Vision judge](../design/brief.md#vision-judge), [Image budget for the judge](../design/brief.md#image-budget-for-the-judge), [CI](../design/brief.md#ci)

# 0012: Measurement protocol: autonomous runs, mutation-seeded defects, 80/5/90 thresholds

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0027

## Context and problem statement

Fazon's claim is its published numbers: first-pass rate, iterations and cost per component, and the judge's catch rate and false-positive rate. The brief asks M0 to define a measured run, the number of repeats, what cost includes, how the judge is calibrated with seeded defects, and the thresholds for trusting it. The [measurement protocol](../spec/measurement.md) settles them.

## Considered options

1. **Repeats per component:** 3, 5 or 10 per round.
2. **Human steps in measured runs:** none (autonomous runs from the approved API); the full journey with a person.
3. **Calibration thresholds** (viewer-only catch rate / false-positive rate / self-agreement): 80% / 5% / 90%; 90% / 2% / 95%; 70% / 10% / 85%.
4. **Seeded defects:** deterministic mutation operators; hand-written patches; both.

## Decision outcome

The maintainer chose:

1. **5 runs per component** per round, each number published with its `n` and a 95% Wilson interval.
2. **Autonomous runs.** They start from the approved API with no feedback or hand edits, and "needs a person" counts as not passing. Interventions in real development are reported separately.
3. **80% / 5% / 90%,** with at least 60% per viewer-only operator. Each is a point estimate from a minimum sample: 40 cases, 10 per operator, and 40 unmodified stories.
4. **Mutation operators:** CSS changes appended in the story build, six measurable and six viewer-only, each naming the stories it affects and what should catch it.

The protocol also:

- measures the API proposal in separate propose runs, which count toward cost;
- measures the checks with and without baselines, so defects only the judge catches are visible;
- ties the judge's calibrated status to a calibration record per model and judge version, shipped with each framework release.

### Consequences

- The run record and provenance schemas (T-0028) include the calibration record and the fields measured runs need: the pinned versions and the operator of each case.
- The budget for a round (Q-0010) follows from 5 runs per component. A full round of 15 components is about 75 generate runs and 75 propose runs.
- Four components may not reach the calibration sample sizes; then the judge stays advisory until the round after M4.
- Changing the judge's instructions, rubric rules or result schema makes a new judge version, which needs a new calibration.

## More information

- Measurement protocol: [docs/spec/measurement.md](../spec/measurement.md)
- Brief: [Measurement](../design/brief.md#measurement), [Vision judge](../design/brief.md#vision-judge)

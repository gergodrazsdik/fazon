# 0028: A calibration case a check catches counts though no pixel changes; viewer-only cases the checks catch stay in the judge's catch rate

- Status: accepted
- Date: 2026-11-27
- Tracker: F-0038, Q-0029, T-0055

## Context and problem statement

Round 1's renders on the example repository ([#97](https://github.com/gergodrazsdik/fazon/pull/97)) showed two things the protocol hadn't foreseen.

- **F-0038:** [ADR 0027](0027-m3-federation-calibration-cost.md) made a case's affected stories the ones whose capture differs, and dropped an application that changes no capture. `raw-color` replaces a role token with its own literal value, which changes no pixel, so it made no case in any component. Yet it's the defect `tokens` `raw-value` exists to catch, and the protocol lists it.
- **Q-0029:** the spec's token rules name the tokens of each variant and state, so the `tokens` check's `token-rule` caught every `emphasis-swapped`, `variants-collapsed`, `state-indistinct` and `state-misleading` case. Only `out-of-family`, and half of `icon-misaligned`, were invisible to the checks. The protocol calls all six operators viewer-only, and the judge's thresholds count their cases.

## Considered options

F-0038:

1. Keep a case a check catches though its pixels don't change.
2. Keep ADR 0027's rule: no change, no case.
3. Change `raw-color` into a visible defect.

Q-0029:

1. Keep the thresholds as written, and report beside the judge's catches which cases the checks caught.
2. Count only the viewer-only cases no check catches.
3. Rework the colour operators so token rules can't see them.

## Decision outcome

The maintainer chose option 1 for both.

### Consequences

- **Flagged stories:** a case whose CSS changes no capture is kept when a check catches it on a story that passes unmodified. Those stories are the case's flagged stories. The judge sees their unmodified pixels, so its verdicts there are the unmodified component's, and the round makes no call for them.
- **Only what the case adds:** a case's check results count only the blocking rules the story doesn't have unmodified. An application that changes no capture and adds no finding still isn't a case.
- **The catch rate stays as written:** every viewer-only case counts toward the judge's catch rate and its per-operator minimum, whether or not a check catches it. Each operator's `checksCaught` in the calibration record shows how many the checks caught, so the defects only the judge catches stay visible.
- In this library, `out-of-family` and the icon shifts are the viewer-only defects the checks miss. That is part of the round's result, not something to tune away.

## More information

- [Measurement protocol: seeded defects](../spec/measurement.md#seeded-defects), [calibration records](../spec/records.md#calibration-records)
- [ADR 0012](0012-measurement.md), [ADR 0027](0027-m3-federation-calibration-cost.md)

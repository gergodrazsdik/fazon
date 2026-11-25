# 0008: Baseline lifecycle: an explicit update command, plain git, the image recorded

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0023, Q-0009

## Context and problem statement

The brief fixes the outline: baselines are PNG files committed in the consumer repo, made only inside the verifier image by a baseline command; a story without one is new and doesn't fail; a baseline change is part of the pull request, and CI confirms a fresh render matches. It leaves open how an intended change gets through the loop, when baselines are written, what happens to baselines of renamed stories, where they live and how they're stored (Q-0009), how a new verifier image is handled, and whether the judge must have seen a baseline before it's accepted.

## Considered options

1. **Visual diffs while generating a component:** advisory for that component; always blocking.
2. **Writing:** an explicit `fazon baseline update`; automatically when the developer accepts the local review.
3. **Orphaned baselines:** fail, removed by the update command; warn only, with a prune command.
4. **Storage (Q-0009):** plain git, losslessly optimised; Git LFS.
5. **A new verifier image:** record the image's digest with the baselines; record nothing.
6. **Location:** `baselines/` at the repository root; next to each component.
7. **The judge before acceptance:** required unless the judge is off; not required.

## Decision outcome

The maintainer chose:

1. **Advisory for the component being generated.** Its diffs go to the person in the report, not to the agent; diffs in any other component block, as side effects.
2. **An explicit command.** `fazon baseline update` writes from a run that passed every other check, in the recorded image. Nothing writes baselines automatically, and CI never does.
3. **Orphans fail,** and the update command removes them. Identical pixels under a new name are reported as renamed.
4. **Plain git,** with PNG files losslessly optimised. This answers Q-0009. It can be revisited if repositories grow uncomfortable.
5. **The image is recorded** in `baselines/fazon.json`. A mismatch fails the visual check with one finding, and `fazon baseline update --all` re-baselines everything in the upgrade's pull request, so the directory never mixes images.
6. **`baselines/` at the repository root,** configurable. Component directories hold only code, which keeps the agent's allowed paths simple.
7. **The judge must have seen it,** unless the judge's policy is `off`, as it is before the judge exists.

### Consequences

- The visual check gains the rules `orphan` and `image`; none of its rules can be exempted.
- The CLI reference (T-0030) documents `fazon baseline update`, and the config file (T-0029) its directory key.
- The reusable workflow (T-0032) compares baselines, lists those a pull request changes, and never writes them.
- A framework upgrade that changes the verifier image always comes with a full re-baseline in the same pull request.

## More information

- Baseline lifecycle: [docs/spec/baseline-lifecycle.md](../spec/baseline-lifecycle.md)
- Brief: [Baselines](../design/brief.md#baselines), [CI](../design/brief.md#ci)

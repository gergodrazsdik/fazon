# 0017: Reusable workflow: verify and judge jobs, the laptop's code path, a pull request comment

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0032

## Context and problem statement

The brief describes the reusable workflow's steps:

1. build Storybook;
2. run the checks in the verifier image;
3. run the judge on new or changed screenshots;
4. upload the report, Storybook and the packed library, and write a job summary.

It runs on `pull_request`, never `pull_request_target`. It's read-only and uses no secrets until a milestone needs them: the judge's API key in M3, Pages in M4, publishing in M5. Its working assumption is a job summary, without an inline gallery in the pull request. The [reusable workflow interface](../spec/workflow.md) settles the jobs, how the verifier runs, artifact retention, and where the result appears.

## Considered options

1. **Jobs:** a `verify` job and a separate `judge` job; one job with the judge as a step.
2. **The verifier in CI:** the CLI on the runner starts the pinned image with Docker, as on a laptop; the job runs inside the image (`container:`).
3. **Artifact retention by default:** 14, 30 or 90 days.
4. **Where the result appears:** the job summary only; the job summary and a comment on the pull request.

## Decision outcome

The maintainer chose:

1. **`verify` and `judge` jobs.** The required check, `verify`, depends on no secret or API; the judge runs after it, and is advisory unless the policy is `blocking`.
2. **The laptop's code path.** CI runs `fazon verify`, which starts the pinned image with Docker, so "a laptop and CI agree" tests one path.
3. **14 days,** configurable with an input.
4. **A comment as well.** A third job, `comment`, creates or updates one comment with the summary. It has `pull-requests: write`, runs no code from the pull request, and is skipped for forks, whose token is read-only.

### Consequences

- The workflows gain a write permission from M1, earlier than the brief's plan; it's limited to the `comment` job and to same-repository pull requests.
- The CLI gains `fazon verify --base <ref> --no-judge`, `fazon judge <run-id>` and `fazon report --summary`.
- The judge job's secret arrives in M3 (T-0056); Pages in M4 through a second reusable workflow (T-0061).
- Consumers allow checkout, setup-node, upload-artifact and download-artifact in their repository settings.

## More information

- Reusable workflow interface: [docs/spec/workflow.md](../spec/workflow.md)
- Brief: [CI](../design/brief.md#ci), [Working assumptions](../design/brief.md#working-assumptions)

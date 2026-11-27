# 0027: Workload identity federation for the judge in CI; a calibration round that fits the budget; seeded defects injected at capture

- Status: accepted
- Date: 2026-11-27
- Tracker: T-0055, T-0056

## Context and problem statement

M3 brings the vision judge. Breaking it down raised three questions.

- **The judge's credential in CI.** The brief gives the judge and CI an API key. The reusable workflow takes it as the optional `anthropic-api-key` secret ([workflow](../spec/workflow.md)). A repository secret is a long-lived key, and the `judge` job installs the pull request's dependencies, so code from the pull request can read it. The Claude API also accepts [workload identity federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation): a GitHub Actions job with `id-token: write` exchanges GitHub's OIDC token for a short-lived API token, bound to a service account in one workspace.
- **The calibration's cost.** The measurement budget through M3 is USD 150 ([ADR 0021](0021-settled-questions.md)), of which M2 spent $2.80. As written, the protocol judges each case with the component's whole plan and repeats every call 5 times on two models. To reach 10 cases per viewer-only operator, round 1 needs about 90 cases. At an estimated $0.35 for one pass over a plan like Button's with Claude Sonnet 5.5, mostly output tokens, Sonnet alone costs about $160, and Opus 5.5 twice that. The judge isn't built yet, so these figures are rough, but they are several times what is left.
- **How a defect gets in.** The protocol puts each operator's CSS into the story build. Building Storybook once per case takes about 90 builds.

## Considered options

The credential in CI:

1. Workload identity federation, with the API key secret kept as an alternative.
2. Workload identity federation only.
3. An API key secret only, as the brief says.

The calibration's cost:

1. Judge only the calls that show the defect, send them through the Message Batches API, and check the estimate against the budget in stages.
2. Fewer repeats or fewer cases.
3. Calibrate only Sonnet 5.5 in round 1.
4. Raise the budget.

The seeded defects:

1. Inject the operator's CSS into the page when each story is captured.
2. Build the story build once per case.

## Decision outcome

The maintainer chose:

1. **Federation in CI, with the API key secret as an alternative.** The brief changes to match.
2. **Make the round cheaper without changing what it measures.** Option 1; the budget stays.
3. **Inject at capture.**

### Consequences

The credential:

- **The judge's credentials:** an API key (`ANTHROPIC_API_KEY`), or the federation variables the Anthropic SDK reads (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`, and `ANTHROPIC_WORKSPACE_ID` when the rule covers more than one workspace). The SDK exchanges and refreshes the token. Without either, the judge exits 3. No other source the SDK knows, such as a profile, is used.
- **Locally, nothing changes.** The judge, `measure` and `calibrate` use an API key. Whether the local judge can do without one stays deferred until after M3, as the brief says.
- **The workflow** gets four non-secret inputs for the federation identifiers, which a caller passes from repository variables. Only the `judge` job asks for `id-token: write`, and the caller grants it. When `anthropic-federation-rule-id` is set, the job uses federation and doesn't pass the API key on. The SDK prefers an API key to federation, so the job never sets both.
- **The token file:** GitHub's OIDC token lasts about five minutes and can be exchanged only once, and the `judge` job may run for 15 minutes. The job writes the token for the audience `https://api.anthropic.com` to a file under `RUNNER_TEMP`, and keeps it fresh for as long as the job runs. How it does that is settled with T-0056.
- **Forks:** the judge is skipped on pull requests from forks, which get neither an identity token nor the secret, and when no credential is configured. The job also checks that the pull request's head repository is the repository itself. The summary says why the judge was skipped.
- **The federation rule** is the adopter's, set up in the Claude Console. The workflow document lists what it should hold:
  - GitHub as the issuer, and the audience `https://api.anthropic.com`;
  - the subject `repo:<owner>/<repo>:pull_request`;
  - a condition that `job_workflow_ref` starts with `gergodrazsdik/fazon/.github/workflows/verify.yml@`, so that only the framework's `judge` job gets a token;
  - a service account in a workspace with its own spend limit, and a short token lifetime.

  Anthropic's docs warn that a rule without a `ref` constraint also matches runs from forks. The judge runs on pull requests, whose subject carries no ref, so the workflow condition and the fork check take its place.
- **What a credential reaches:** code from a pull request can still reach the credential while the job runs. With federation it gets short-lived tokens, capped by the workspace's spend limit, instead of a key that lasts until it's rotated.
- **Superseded wording:** this refines [ADR 0001](0001-baseline.md)'s "called directly through the API with an API key for now" and [ADR 0017](0017-workflow.md)'s "the judge's API key in M3". WF-002 covers either credential.

The calibration's cost:

- **Affected stories:** a case's affected stories are those whose capture, in any theme, differs from the unmodified component's. An application that changes no capture isn't a case.
- **Affected calls only:** a case makes only the calls of the component's plan that include an affected story. Each call has a fresh context, so a call without one would answer as it does for the unmodified component, which the round judges anyway. The batches stay as the plan makes them, so every call the case makes is a call the judge would make.
- **The Message Batches API:** calibration sends its calls as batches, which cost half as much and return within 24 hours. The requests are the ones a direct call makes. Costs are reported at the price paid, with a note that a direct call costs twice as much.
- **Stages:** a round starts with the unmodified components, which it needs anyway for the false-positive rate and self-agreement. Their measured cost per call gives the estimate for the cases. The cases start only if that estimate fits what's left of the budget; otherwise the maintainer decides. Sonnet 5.5, the configured model, goes first. Opus 5.5 follows with a new estimate from Sonnet's measured costs.
- **Expected effect:** about half the calls of a pass, at half the price, so about a quarter of the cost: roughly $40 for Sonnet and $80 for Opus. The stages replace this guess with measured figures before most of the money is spent.

The seeded defects:

- The harness adds the operator's CSS to the page after the story loads and before it's captured, with the same scoping by `data-part` and state attributes. The story build and the component's code stay unchanged.
- `raw-color` is then caught by the `tokens` check alone: `lint` reads the component's source files, which the operator no longer touches.

## More information

- [Brief: authentication](../design/brief.md#authentication), [brief: CI](../design/brief.md#ci)
- [Judge](../spec/judge.md), [measurement protocol: judge calibration](../spec/measurement.md#judge-calibration), [reusable workflow interface](../spec/workflow.md), [CLI reference](../spec/cli.md), [config file reference](../spec/config.md)
- [ADR 0011](0011-judge.md), [ADR 0012](0012-measurement.md), [ADR 0017](0017-workflow.md), [ADR 0021](0021-settled-questions.md)

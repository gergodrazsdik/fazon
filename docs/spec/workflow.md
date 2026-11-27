# Reusable workflow interface

The GitHub Actions workflow a consumer repository calls to verify every pull request: how it's called, its inputs, secrets and permissions, its jobs, what it uploads and reports, and the rules it keeps. CI verifies; it never generates or repairs code ([brief](../design/brief.md#ci)). Decisions behind it: [ADR 0017](../adr/0017-workflow.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0032.

## Scope

| What | Defined in |
|---|---|
| The checks and their findings | [Check catalogue](check-catalogue.md) |
| Which baselines count as added or changed, and that CI never writes them | [Baseline lifecycle](baseline-lifecycle.md#in-ci) |
| The judge in CI: its policy, cap and skipping forks | [Judge](judge.md) |
| The commands the jobs run | [CLI reference](cli.md) |
| How the example repository pins the workflow before M5 | [Adapter boundary](adapter-boundary.md#consuming-the-framework-before-m5) |

## Calling it

`fazon init` writes a short workflow into the consumer repository ([example](examples/workflow/fazon.yml)):

```yaml
on:
  pull_request:

permissions: {}

jobs:
  fazon:
    uses: gergodrazsdik/fazon/.github/workflows/verify.yml@<sha or tag>
    permissions:
      contents: read
      pull-requests: write
    secrets:
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

- **Reference:** before M5, the framework commit the repository pins ([ADR 0016](../adr/0016-adapter-boundary.md)); from M5, a release tag.
- **Trigger:** `pull_request`, never `pull_request_target`.
- **Permissions:** the caller grants the most any job needs. Each job asks only for its own, and a reusable workflow can't raise them.
- **Allowed actions:** the actions the workflow uses (checkout, setup-node, upload-artifact, download-artifact) must be allowed in the consumer repository's settings.

## Inputs, secrets and outputs

| Input | Default | Meaning |
|---|---|---|
| `working-directory` | `.` | Where `fazon.yaml` and `package.json` are, from the repository's root. |
| `node-version-file` | `.node-version` | The file that names the Node.js version to install, from the repository's root. |
| `install-command` | `pnpm install --frozen-lockfile` | The command that installs the dependencies; see [installing](#installing). |
| `artifact-retention-days` | `14` | How long the artifacts are kept. |
| `timeout-minutes` | `30` | The `verify` job's limit; the `judge` job has half of it. |

| Secret | Required | Used by |
|---|---|---|
| `anthropic-api-key` | no | the `judge` job only. Without it, which is always the case for pull requests from forks, the judge is skipped and the summary says so. |

| Output | Meaning |
|---|---|
| `status` | The `verify` job's status: `fazon verify`'s `ok`, `failed` or `error`. It is `failed` when `fazon spec check` or `fazon sync --check` fails or `fazon verify` refuses, and `error` when `fazon verify` didn't run. |

## Jobs

### `verify`

The required check, named `<caller job> / verify` (for example `fazon / verify`). Permissions: `contents: read`; no secret.

1. Check out the pull request with its history, and without persisting credentials.
2. Install Node.js and the repository's dependencies from its lockfile, as [installing](#installing) describes.
3. `fazon doctor`. It refuses when `fazon.local.yaml` exists. Before M5, it also checks that the installed CLI comes from the commit the workflow was called at ([ADAPTER-003](adapter-boundary.md#rules)).
4. `fazon spec check` and `fazon sync --check`.
5. `fazon verify --base <base branch> --no-judge`. It runs the source and rendered checks in the pinned verifier image, started with the runner's Docker exactly as on a laptop, and marks the stories whose baselines the pull request adds or changes.
6. Upload the artifacts, even when a step failed: `fazon-storybook`, `fazon-package` and `fazon-run` first.
7. `fazon report --no-open <run>` builds the run's HTML report, also when `fazon verify` failed. A report that can't be built doesn't fail the job; the summary says so.
8. `fazon report --summary` writes the job summary, under a heading with the job's status and any of steps 2 to 4 that failed, with links to the artifacts. It is uploaded as `fazon-report`, with the HTML report beside it when step 7 built one.

The job fails when any check has a blocking finding, or any step fails.

#### Installing

The job installs pnpm at the version `package.json`'s `packageManager` names, when it names one, and then runs the `install-command` input with bash in the working directory. The default, `pnpm install --frozen-lockfile`, installs from the lockfile. A repository whose install needs more passes its own command, which may also set variables for the later steps through the file `$GITHUB_ENV` names. Before M5, the example repository builds the pinned framework commit first ([ADR 0022](../adr/0022-build-from-source-and-component-names.md)):

```yaml
    with:
      install-command: scripts/framework.sh && pnpm install --frozen-lockfile
```

The other steps run the CLI as `node_modules/.bin/fazon` in the working directory, where a package manager installs it.

### `judge`

Runs after `verify` passes, unless the judge's policy is `off` or the secret is missing. Until the judge arrives in M3 (T-0056), `fazon verify` reports it unavailable and the job is skipped; the summary says so. Permissions: `contents: read`; the API key, as an environment variable for this job only.

1. Check out, install, and download `verify`'s run and captures.
2. `fazon judge <run>`: the judge looks at the stories with added or changed baselines, within the CI cap ([judge](judge.md#cost)).
3. Add the judge's verdicts to the summary and the report artifact.

With policy `advisory` (the default), the job fails only on its own errors, never on a verdict. With `blocking`, a `fail` verdict fails it, and the repository can make `fazon / judge` a required check.

### `comment`

Runs after the other two, whatever their result, for pull requests from branches of the same repository. Permissions: `pull-requests: write`.

It downloads the summary the earlier jobs wrote (`summary.md` in the `fazon-report` artifact), and creates or updates one comment on the pull request, found by a hidden marker (`<!-- fazon:summary -->`), with that summary and a link to the `fazon-report` artifact (the verify job's `report-url` output), which the job summary can't carry, as it's written before the upload. It checks out nothing, runs no code from the repository, and never sees the API key. Pull requests from forks get a read-only token, so for them the job is skipped, and the job summary is the only place for the result.

## What it reports

The **summary**, in the job summary and the comment, gives each component:

- its check results and blocking findings;
- its judge verdicts, and the stories not judged with the reason;
- the baselines the pull request adds, changes, removes or renames;
- the judge's cost.

It links to the artifacts: `fazon report --summary` ends with a placeholder line, `<!-- fazon:artifacts -->`, which the workflow replaces with the links.

| Artifact | Content |
|---|---|
| `fazon-report` | the summary (`summary.md`) and the HTML report (`report/index.html`, with the captures, diff images and before-and-after images of changed baselines it shows in `report/images/`; judge findings from M3). Without a run, or when the report can't be built, only the summary. The report's story links point at a local Storybook (`FAZON_STORYBOOK_URL`, by default `http://localhost:6006`), such as `fazon-storybook` served there |
| `fazon-storybook` | the static Storybook build |
| `fazon-package` | the packed library tarball |
| `fazon-run` | the verify run's directory without its Storybook build and tarball: the record, `verify.json`, captures and diff images, logs and tool reports, which the `judge` job reads |

No artifact contains a transcript, a credential or the agent's prompts.

## From M4: Pages

A second reusable workflow, `pages.yml`, deploys the Storybook build and the docs site to GitHub Pages on pushes to `main`. Its caller grants `pages: write` and `id-token: write` to that workflow only. T-0061 specifies it when the site exists.

## Rules

| Rule | What must hold |
|---|---|
| WF-001 | No workflow uses `pull_request_target`, and none writes code, baselines or commits. |
| WF-002 | Each job has only the permissions in this document; the API key reaches only the `judge` job. |
| WF-003 | The `comment` job runs no code from the pull request. |
| WF-004 | Every action is pinned to a full commit SHA. |
| WF-005 | The required check depends on no secret and no API: `verify` passes or fails on the checks alone. |
| WF-006 | Artifacts hold no transcript, prompt or credential. |

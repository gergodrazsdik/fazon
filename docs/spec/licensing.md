# License terms

Which license covers what: the framework, what Fazon writes into another repository, the example repository, and the third-party material that reaches either. Decisions behind them: [ADR 0019](../adr/0019-license-terms.md).

- Version: **0**; it may change in any pull request until Fazon 1.0.
- Tracker: T-0034, Q-0002, Q-0003, Q-0004.

This document describes the project's licensing choices. It isn't legal advice for adopters.

## At a glance

| What | License |
|---|---|
| The framework: CLI, adapters, verifier, skills, workflows, documentation | [GPL-3.0-or-later](../../LICENSE) |
| Template text: everything Fazon writes into another repository | [MIT-0](../../LICENSES/MIT-0.txt) |
| The example library's drafts in [example-library/](example-library/README.md) | [MIT-0](example-library/LICENSE) |
| The example repository, `fazon-vue-example` | MIT-0 |
| Lucide, the fixture icon set | ISC, and MIT for the icons derived from Feather |
| Inter, the example library's font | SIL Open Font License 1.1 |

## What Fazon writes into another repository

The framework is GPL-3.0-or-later, but what it writes into an adopter's repository must not bring that repository under the GPL ([brief](../design/brief.md#licensing)). So everything Fazon writes there is licensed under **MIT-0**, which asks for nothing in return, not even a notice:

- `fazon init`: `fazon.yaml`, the starter token set, the conventions doc, the CI workflow, the `.gitignore` and `.gitattributes` entries, and the adapter's scaffold (build, type-check, lint, test and Storybook configuration, the package entry file);
- `fazon spec new`: the spec scaffold; `fazon propose`: the proposed API fields;
- `fazon sync` and every run: the `generated/` directories (story files, contract tests, story manifest, API, provenance), the entry file's exports, the token CSS;
- `fazon baseline update`: the baselines, `fazon.json` and `NOTICE.md`.

**No headers.** These files carry no license header and no copyright line; the adopter's own license covers their repository. MIT-0 needs no notice, so nothing has to be kept.

**Where the grant comes from.** In the framework's source, text written into another repository lives in template files, each starting with `SPDX-License-Identifier: MIT-0`; that line isn't written out. Code that assembles output, such as the story file generator, adds only template text and the adopter's own data: names, values and paths from their specs, tokens and config. The code itself stays GPL-3.0-or-later.

**What Fazon claims nothing in.** The specs, tokens and conventions a person writes, and the component code the agent writes in the adopter's repository, are the adopter's. Fazon grants no license to them and claims none.

Contributions to template text are licensed under MIT-0 as well as the GPL: the contributor agreement lets the maintainer license a contribution under other terms, as long as the project's licenses on the day it was submitted apply too (Section 2.3). Third-party material goes into a template only if its license allows MIT-0 terms for it.

## The example repository

`fazon-vue-example` is licensed under MIT-0, as Fazon's output is, so it can serve as a template that others copy without conditions. The drafts in [example-library/](example-library/README.md) are MIT-0 already, so they move there unchanged in M1:

- [LICENSE](example-library/LICENSE): MIT-0;
- [THIRD-PARTY-NOTICES.md](example-library/THIRD-PARTY-NOTICES.md): Inter and Lucide, with their license texts;
- [CONTRIBUTING.md](example-library/CONTRIBUTING.md): no outside contributions.

**Contributions:** the example repository takes no outside pull requests before the publishing decision (T-0071). It has no contributor agreement and no CLA assistant; issues go to the framework repository. The publishing decision settles whether that changes (T-0086).

## Third-party notices

### Lucide

The fixture icons come from the `lucide-static` package. Its license is ISC, and the icons Lucide derived from Feather, such as `check`, `x` and `chevron-down`, are MIT; both ask for their notice to go with copies. Copies appear in three places:

| Where | How the notice goes with it |
|---|---|
| The framework's packages and the verifier image | `lucide-static` is a dependency, installed with its own license file. |
| The static Storybook build | The adapter's Storybook setup copies the icon set's license notice into the build. |
| The committed baselines, which show rendered icons | `fazon baseline update` writes `NOTICE.md` in the baselines directory, with the icon set's license notice, whenever the icon set is Lucide ([baseline lifecycle](baseline-lifecycle.md#where-baselines-live)). |

With their own icon set (`icons` in the [config](config.md#keys)), adopters handle its notices themselves; Fazon writes no `NOTICE.md` for it.

### Inter

Only the example library uses Inter, from the `@fontsource-variable/inter` package. The OFL doesn't cover documents made with the font, so captures and baselines need nothing. The font files need their license: the example repository's notices file holds it, and its packed library includes that file whenever the package ships the font files (Q-0011).

### The verifier image

The image also contains Chromium, system fonts and operating system packages. Their license notices and the image's software bill of materials arrive with signed image releases in M5 (T-0066).

## Rules

| Rule | What must hold | Checked by |
|---|---|---|
| LICENSE-001 | Every file Fazon writes into another repository is built from MIT-0 template text and the adopter's own data. | review, and the header check from M1 (T-0083): template files carry `MIT-0`, all other source files `GPL-3.0-or-later` |
| LICENSE-002 | A written file carries no license header or copyright line. | the framework's tests of `init`, `spec new` and `sync` output, from M1 |
| LICENSE-003 | When the icon set is Lucide, the baselines directory has a current `NOTICE.md`, and the static Storybook build carries the same notice. | `fazon baseline update`; the visual check's `orphan` rule allows only this one extra file |

# 0002: Contributor License Agreement: Harmony, any outbound license

- Status: accepted, amended by [0004](0004-contributor-agreement-amended.md)
- Date: 2026-11-25
- Tracker: T-0008, T-0010 to T-0014, Q-0015, Q-0016

## Context and problem statement

The brief decides that outside contributors sign a contributor license agreement so the project can be relicensed ([Licensing](../design/brief.md#licensing)). Its purpose is narrow but concrete: the maintainer wants to be able to offer Fazon under a commercial license alongside the GPL, for example to a company that uses it in an internal pipeline and pays for different terms, and to give an employer that adopts Fazon a commercial license free of charge. No commercial license exists yet, so the agreement has to leave the outbound terms open rather than name them. Contributors keep their copyright. Which agreement text, and how is it signed?

## Considered options

1. The Apache Individual Contributor License Agreement, adapted to a single maintainer. Broad copyright and patent license with the right to sublicense; written for the Apache Software Foundation, so adapting it means editing legal text (the foundation's name throughout, its nonprofit clause).
2. The Harmony Individual Contributor License Agreement (HA-CLA-I 1.0) with outbound Option Five: a license grant, not an assignment, and the maintainer may license the contribution under any license, including commercial and proprietary ones, provided it also stays available under the license the project used on the submission date. A template made to be filled in.
3. A copyright assignment, such as the FSFE Fiduciary License Agreement. Rejected: contributors should keep their copyright.

## Decision outcome

Chosen option: "Harmony HA-CLA-I 1.0 with Option Five", because its outbound option fits the dual-licensing purpose exactly, contributors keep their copyright, and it needs only fill-ins, no edits to legal text.

- `CLA.md` in the repo is the canonical agreement, with its source, version and changes noted at the top. Any copy a signing service needs is made from it.
- Signing runs through the hosted CLA assistant (cla-assistant.io) as a GitHub App. Its GitHub Action variant was archived in March 2026, and it would need `pull_request_target` with write permissions, which this repository forbids.
- The maintainer's account and Dependabot are exempt from signing.

### Consequences

- The agreement is reviewed before the first outside contribution is accepted; its open blanks (governing law) are filled in then. Neither the template nor an agent gives legal advice.
- Until the CLA assistant is installed and has reported on a test pull request, no outside pull request is merged; then its status joins the required checks.
- A company contributing as such needs an entity agreement (Harmony HA-CLA-E), decided before the first contribution from a company.
- Contributors may not expect the GPL to be the only license their contribution is ever distributed under; CONTRIBUTING.md says so.

## More information

- [Harmony agreements](https://www.harmonyagreements.org/agreements.html), CC BY 3.0 Unported
- [CLA assistant](https://github.com/cla-assistant/cla-assistant)

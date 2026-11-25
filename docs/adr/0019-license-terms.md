# 0019: License terms: MIT-0 for Fazon's output and the example repository, no headers, notices with the baselines

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0034, Q-0002, Q-0003, Q-0004

## Context and problem statement

The framework is GPL-3.0-or-later, with a contributor agreement so it can be relicensed. The brief requires that what Fazon writes into an adopter's repository doesn't bring that repository under the GPL, and proposes three answers for M0:

- MIT-0 for all of Fazon's output (Q-0002);
- the same license for the example repository (Q-0003);
- no outside contributions to the example repository before the publishing decision (Q-0004).

ADR 0003 already keeps the GPL header out of written files. ADR 0006 and ADR 0018 add Lucide's and Inter's notices. Reading Lucide's license file showed that it is ISC with MIT for the icons derived from Feather, including `check`, `x` and `chevron-down`, which the examples use.

## Considered options

1. **Fazon's output:** MIT-0; MIT; CC0 1.0.
2. **Headers on written files:** none; an `SPDX-License-Identifier: MIT-0` line.
3. **The example repository:** MIT-0; MIT; Apache-2.0.
4. **Contributions to the example repository:** none yet; the framework's contributor agreement; inbound under its own license.

## Decision outcome

The maintainer chose:

1. **MIT-0** for everything Fazon writes into another repository. It asks for nothing, not even a notice, so generated files can be used, changed and relicensed freely.
2. **No headers.** Written files carry no license header or copyright line; the adopter's license covers their repository.
3. **MIT-0** for the example repository, so it works as a template others copy.
4. **No outside contributions yet.** The example repository has no contributor agreement; issues go to the framework repository. The publishing decision revisits this.

Two more choices complete the terms:

- **Licensing the templates, not an exception.** Template text in the framework's source is MIT-0 (`SPDX-License-Identifier: MIT-0`, not written out), and the code that assembles output adds only the adopter's own data. Output then holds no GPL material, so no exception to the GPL is needed. The contributor agreement's outbound clause (Section 2.3) allows this for contributions to templates, once MIT-0 is one of the project's licenses, which this decision makes it.
- **Notices next to the copies.** `fazon baseline update` writes `NOTICE.md` with Lucide's notice into the baselines directory, as baselines show rendered icons. The static Storybook build carries the same notice. The example repository has a third-party notices file for Inter and Lucide.

### Consequences

- The framework repository gains `LICENSES/MIT-0.txt`, and its README says what's MIT-0.
- The header check (T-0083) accepts `MIT-0` on template files and requires `GPL-3.0-or-later` everywhere else.
- BASELINE-001 allows `NOTICE.md` in the baselines directory.
- The drafts in `docs/spec/example-library/` are MIT-0 already, with a license, a notices file and a contributing guide, and move to the example repository unchanged (T-0040).
- The verifier image's own notices and software bill of materials arrive with signed releases in M5 (T-0066).

## More information

- License terms: [docs/spec/licensing.md](../spec/licensing.md)
- Brief: [Licensing](../design/brief.md#licensing)
- [ADR 0003](0003-bootstrap-answers.md): license headers

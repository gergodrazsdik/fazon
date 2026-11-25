# 0003: License headers, run-record path, npm name and the agreement's governing law

- Status: accepted
- Date: 2026-11-25
- Tracker: Q-0012, Q-0013, Q-0014, Q-0015, Q-0016, T-0082, T-0083

## Context and problem statement

The bootstrap left five questions for the maintainer: whether source files carry a license header, where run records and reports go, whether to reserve the npm name `fazon` before the publishing decision, the contributor agreement's governing law, and the agreement's other fill-ins. They are small and related to the repository's setup, so they are recorded together.

## Considered options

Each question had one proposal, which the maintainer accepted; the alternatives are noted under each decision.

## Decision outcome

- **License headers (Q-0013).** Every source file in this repository starts with `SPDX-License-Identifier: GPL-3.0-or-later` as a comment, on the first line or right after a shebang. The header names the license only; the copyright notice stays in README.md and LICENSE, as contributors keep the copyright in their contributions. Files Fazon writes into an adopter's repository (from `fazon init`, the scaffolds, generated components, stories and tests) don't carry it: their license is settled in M0 (Q-0002). A check that enforces the header arrives with the first TypeScript code (T-0083). Alternative not taken: no headers, relying on LICENSE alone.
- **Run-record path (Q-0012).** Run records and HTML reports go under `.fazon/` in the repository where Fazon runs, which `.gitignore` excludes. The committed per-component provenance files live outside it. The run record document (T-0028) defines the layout inside.
- **npm name (Q-0014).** The name `fazon` is reserved on npm now with a placeholder package: version `0.0.0`, a README pointing to the repository, no code (T-0082). This is not a release, and the publishing decision after version 1 still stands; the maintainer publishes it with their own account. Alternative not taken: wait for the publishing decision and risk losing the name.
- **Governing law (Q-0015).** The contributor agreement is governed by the laws of Hungary, where the maintainer lives (`CLA.md`, Section 6.1).
- **The agreement's fill-ins (Q-0016).** The maintainer confirmed them: the maintainer personally as "We"; CC BY 4.0, CC BY-SA 4.0 and CC0 1.0 as the licenses for media; "[or Your Affiliates]" left out of the patent license. The legal review before the first outside contribution (T-0010) still checks the whole text.

### Consequences

- New source files need the header from the start; the lint check makes it a gate once code exists.
- The placeholder version `0.0.0` can never be published again on npm; real releases start above it.
- npm may reassign a name that holds only a placeholder if someone disputes it under its package name policy; the README's pointer to an active repository is the mitigation.

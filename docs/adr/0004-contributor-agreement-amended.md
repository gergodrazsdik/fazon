# 0004: The contributor agreement, amended after a best-effort review

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0010, Q-0017
- Amends: [0002](0002-contributor-license-agreement.md)

## Context and problem statement

ADR 0002 chose the Harmony individual agreement and planned a lawyer's review before the first outside contribution. A non-lawyer review under Hungarian law, the agreement's governing law, raised seven points (listed under T-0010 in the tracker). The main one: the Copyright Act voids a licence clause for an unspecified number of the author's future works (Szjt. 44. § (1)), and software is not exempt from it (60. § (5)); a sign-once agreement for every later contribution resembles such a clause. The review's Copyright Act citations were checked against the official text; its Civil Code citation was not.

A lawyer's review costs more than a project with no users or outside contributors yet justifies. How is the review completed?

## Considered options

1. Pay for a lawyer's review before the first outside contribution, as ADR 0002 planned.
2. Accept the review's findings as best effort, amend the agreement accordingly, and record that no lawyer has reviewed it.
3. Keep the Harmony text unchanged and accept the risks the review named.

## Decision outcome

Chosen option: "accept the findings as best effort", because it addresses the named risks at no cost, and a lawyer can still review the text later, for example before the publishing decision or the first contribution from a company.

The amendments, each listed at the top of `CLA.md`:

- **Each Submission is its own grant** (new Section 2.7), and the agreement covers Fazon only: accepting the agreement licenses no work not yet created, so it doesn't license future works as such (Szjt. 44. § (1), 52. §). The PR template repeats it.
- **Uses named explicitly** (Section 2.1(b)): making the contribution available to the public, including online, besides distributing it.
- **Moral rights** (Section 2.4): the waiver stays to the extent the law allows; where it doesn't (Szjt. 9. § (2)), the contributor keeps them, and the maintainer keeps their authorship recorded in the version history, including in commercially licensed versions.
- **Media** (new Section 2.8): non-software parts of a contribution are also licensed by their author to everyone under CC BY 4.0. A free, non-exclusive licence the author offers to the public needs no written form (Szjt. 45. § (2) d)), which a click in the CLA assistant may not satisfy for non-software works.
- **Section 3**: no reference to an Entity version (the corporate agreement is deferred) or a guardian's signature, which the CLA assistant can't collect; contributors confirm they are at least eighteen (new 3(e)). Work made as an employment duty belongs to the employer (Szjt. 30. § (1)); CONTRIBUTING.md says so.
- **The commercial relicensing right is shown at signing**: the CLA assistant's copy is the whole of `CLA.md`, including the note that explains it.

### Consequences

- No lawyer has reviewed the agreement. Revisit that before the publishing decision, before accepting a contribution from a company, or when outside contributions become regular.
- A contributor's home-country author protections may still apply whatever the governing law; no wording changes that.
- Changing `CLA.md` makes the CLA assistant ask contributors to sign again; its Gist must match the file (T-0012).

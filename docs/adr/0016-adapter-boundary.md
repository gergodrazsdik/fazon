# 0016: Adapter boundary: pre-release images on GHCR, git dependencies at a SHA, vue-component-meta

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0031, Q-0001

## Context and problem statement

The brief splits Fazon into a framework-neutral core and framework adapters, and lists what an adapter supplies. It proposes that before M5 the example repository pins one framework commit, with the CLI and adapter as a git dependency, the reusable workflow by commit SHA, and "the verifier image built in CI from that commit" (Q-0001). [ADR 0014](0014-config.md) since requires `image` in `fazon.yaml` as a digest. The contract tests ([ADR 0007](0007-check-catalogue.md)) need the adapter to read a component's actual API. The [adapter boundary](../spec/adapter-boundary.md) settles these.

## Considered options

1. **The verifier image before M5:** pushed to GHCR by the framework's CI for each commit on `main`, pinned by digest; built from source by the example repository's CI and by each laptop.
2. **The packages before M5:** pnpm git dependencies at a commit SHA; tarballs attached to GitHub pre-releases.
3. **Reading a Vue component's API:** vue-component-meta, statically from its TypeScript; runtime introspection of the mounted component.

## Decision outcome

The maintainer chose:

1. **Pre-release images on GHCR.** The framework's CI pushes `fazon-verifier:sha-<sha>` on every push to `main`, and the example repository pins its digest. Laptop and CI then run the same image from M1, as the config requires. This changes the brief's plan, which kept image publishing to M5. One job of the framework's CI gets `packages: write` from M1. Signing and provenance attestations still come with the releases in M5.
2. **Git dependencies at a SHA,** as the brief proposed. The packages build when installed, and the workflow and the image name the same commit, which a check in the example repository enforces.
3. **vue-component-meta,** which reads props with their types and defaults, events, slots, exposed members and models.

The document also lists the adapter's capabilities, and fixes the Vue adapter's file layout, API mapping, extension schema, stories, contract tests, commands and what `init` writes.

### Consequences

- M1 adds an image job with `packages: write` to the framework's CI (T-0046, T-0066).
- Pre-release images are public on GHCR and unsigned until M5. They are referenced by digest, never by tag.
- The npm names of the adapter package, and of any core package beyond `fazon`, are open (Q-0018); the example repository's dependencies use them once settled.
- vue-component-meta joins the consumer's pinned dev dependencies.

## More information

- Adapter boundary: [docs/spec/adapter-boundary.md](../spec/adapter-boundary.md)
- Brief: [Framework adapters](../design/brief.md#framework-adapters), [Before packaging](../design/brief.md#before-packaging), [CI](../design/brief.md#ci)

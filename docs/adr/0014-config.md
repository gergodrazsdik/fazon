# 0014: Config: fazon.yaml, a limited local override, the image pinned explicitly

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0029

## Context and problem statement

The earlier M0 documents leave many settings to the config file:

- the caps, models, escalation threshold and effort;
- the judge's policy, CI cap, repeats and prices;
- the specs, components, entry, tokens, conventions and baselines paths;
- the fixture icon set;
- the verifier image.

The brief names an `adapter` key and an `image` key pinned by digest. The [config file reference](../spec/config.md) settles the file's name and format, whether a developer may override it locally, and how the image is pinned.

## Considered options

1. **Name and format:** `fazon.yaml` with a JSON Schema; `fazon.config.json` with a `$schema` key; `fazon.config.ts` with a typed `defineConfig()`.
2. **Local overrides:** a gitignored `fazon.local.yaml` limited to caps, models, effort and the local judge; no overrides; any key.
3. **The image:** a required key with an explicit digest; a default taken from the CLI's version.

## Decision outcome

The maintainer chose:

1. **`fazon.yaml`,** validated against a published JSON Schema. It allows comments, is read without executing code, and is framework-neutral.
2. **A limited local file.** It may change only `loop`, `models`, `effort` and the local judge (`judge.localPolicy`). The run record lists every override, and measured runs and CI refuse to start while it exists.
3. **Required and explicit.** An image change is a visible line in the pull request, together with the full re-baseline it needs.

The reference also makes unknown keys errors, keeps credentials out of the file (the API key comes from the environment), and lets prices override the framework's own table.

### Consequences

- The CLI reference (T-0030) says that `fazon init` writes `fazon.yaml` and gitignores `fazon.local.yaml` and `.fazon/`, and which command updates `image` on an upgrade.
- The adapter boundary (T-0031) may add adapter options under `adapter`, which then becomes an object.
- `just lint` validates the config examples and checks that the local schema's shared definitions match the main schema's; `jq` becomes a required tool.

## More information

- Config file reference: [docs/spec/config.md](../spec/config.md)
- Brief: [Repositories and deliverables](../design/brief.md#repositories-and-deliverables), [Caps and stop rules](../design/brief.md#caps-and-stop-rules)

# Verifier image

The container image in which Fazon renders stories and runs the rendered checks. A laptop and CI run the same image, pinned by digest, so they render the same pixels ([check catalogue: visual](../docs/spec/check-catalogue.md#visual), [rendering conditions](../docs/spec/story-matrix.md#rendering)).

## What's in it

| Part | Version | How it's pinned |
|---|---|---|
| Base | `mcr.microsoft.com/playwright:v1.65.1-noble` (Ubuntu 24.04) | By digest in the `FROM` line of the [Containerfile](Containerfile) |
| Browsers | Playwright 1.65.1's, in `/ms-playwright`; Chromium build 1255 (Chrome for Testing 159.0.8154.6) | By the base image |
| Node.js | 26 | By the base image |
| Generic fonts | DejaVu Sans, DejaVu Serif, DejaVu Sans Mono (`fonts-dejavu-core` and `fonts-dejavu-mono` 2.37-8) | Exact versions from the Ubuntu snapshot of 2026-11-24 (`snapshot.ubuntu.com`) |
| Font rules | [fonts.conf](fonts.conf), installed as `/etc/fonts/conf.d/52-fazon-generic.conf` | In this repository |

The generic families resolve to one named font each:

| CSS family | Font |
|---|---|
| `system-ui`, `ui-sans-serif`, `sans-serif` | DejaVu Sans |
| `serif`, `ui-serif` | DejaVu Serif |
| `monospace`, `ui-monospace` | DejaVu Sans Mono |

A button's default font (the browser's own style) is DejaVu Sans too. Text is antialiased in greyscale with slight hinting. Libraries bring their own fonts, such as the example library's Inter; only the generic families come from the image. The base image's other fonts (Liberation, Noto Color Emoji, WenQuanYi Zen Hei and others) stay as fallbacks for characters DejaVu lacks.

The image runs as the base image's `pwuser` (uid 1001, the uid of GitHub's hosted runners), with `TZ=UTC`. It's built for linux/amd64 only; on another architecture it runs emulated.

**Playwright version:** the framework's packages pin `playwright-core` 1.65.1, the version whose browsers the base image carries. Playwright fails to launch when the two differ, so they move together.

**Changing a pin:** a new base image, snapshot date or font version moves pixels, and every consumer's baselines are made again ([image upgrades](../docs/spec/baseline-lifecycle.md#image-upgrades)). Change the date and the versions together: the build uses only the snapshot as an apt source.

## How it's published

The [verifier workflow](../.github/workflows/verifier.yml) builds the image and runs the smoke test:

- On a pull request that changes `verifier/` or the workflow: build and smoke test; nothing is pushed.
- On every push to `main`: build, smoke test, then push `ghcr.io/gergodrazsdik/fazon-verifier:sha-<commit>`. The job summary shows the pushed digest. Only this job has `packages: write`.

Consumers pin the digest, never the tag: `image: ghcr.io/gergodrazsdik/fazon-verifier@sha256:…` in `fazon.yaml` ([config](../docs/spec/config.md), [adapter boundary](../docs/spec/adapter-boundary.md#consuming-the-framework-before-m5)). Until M5 the images are unsigned and have no provenance attestation.

## Build and smoke-test it locally

With rootless Podman (`docker` works the same), from the repository root:

```sh
podman build --platform linux/amd64 --build-arg REVISION="$(git rev-parse HEAD)" \
  -t localhost/fazon-verifier:dev -f verifier/Containerfile verifier
CONTAINER_CLI=podman verifier/smoke/run.sh localhost/fazon-verifier:dev
```

The first build pulls the base image, about 2.6 GB unpacked. Podman warns that `SHELL` isn't kept in the OCI image format; that only affects images built on top of this one, and the build itself uses it.

The [smoke test](smoke/) runs in the image and fails unless:

- `fc-match` resolves `system-ui`, `sans-serif`, `serif` and `monospace` to the fonts above;
- each page renders at 1024 by 768 and a device scale factor of 2 to a 2048 by 1536 capture;
- two separate browser launches render each page to the same bytes;
- the visual check's fixtures behave as documented: `pass.html` renders the bytes of `base.html`, `fail.html` doesn't;
- Chromium renders each generic family, and a button's default font, with the expected font (read through the DevTools protocol).

It writes the captures and `results.json`, with each capture's SHA-256, to the output directory (a temporary directory when none is given). It installs `playwright-core` from [smoke/package-lock.json](smoke/package-lock.json) inside the container, so the container needs network access.

## Not in it yet

- **Fazon's code.** The CLI and the verifier are installed in a later M1 step (T-0046), at the place the Containerfile marks.
- **License notices and an SBOM** for Chromium, the fonts and the operating system packages, and **signed releases** with provenance: M5 (T-0066, [licensing](../docs/spec/licensing.md#the-verifier-image)).
- **Other architectures.** Captures are made only on linux/amd64.

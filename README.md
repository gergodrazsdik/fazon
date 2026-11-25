# Fazon

Fazon is a framework that lets a coding agent build UI components from written specs, then verifies each one: it renders the component, runs deterministic checks (build, types, lint, tests, accessibility, token conformance, layout, visual diff) and asks a vision model to judge only what those checks cannot measure. A person decides at three points: the component's API, the local review of the result, and the pull request. Version 1 targets Vue 3, with a 15-component example library in a separate repository, `fazon-vue-example`.

## Status

Pre-release, in the specification phase (milestone M0): this repository holds documents, not code yet. Nothing is published to a package registry.

- [Design brief](docs/design/brief.md): scope, architecture and milestones
- [Specification documents](docs/spec/README.md): the M0 documents, as they are written
- [Work tracker](docs/plan/TRACKER.md): what's open and next
- [Decision records](docs/adr/README.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Outside contributions need a signed [Contributor License Agreement](CLA.md) before they can be merged. Security problems: [SECURITY.md](SECURITY.md).

## License

Fazon is licensed under the GNU General Public License, version 3 or later (SPDX: `GPL-3.0-or-later`). See [LICENSE](LICENSE).

Copyright (C) 2026 Gergő Drazsdik

What Fazon writes into your repository (the files from `fazon init`, scaffolds, generated stories and tests, baselines) is licensed under [MIT-0](LICENSES/MIT-0.txt) and carries no header, so it doesn't bring your repository under the GPL. See the [license terms](docs/spec/licensing.md).

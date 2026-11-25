# Changelog

All notable changes to Fazon are in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). There is no release yet; releases are versioned from milestone M5.

## [Unreleased]

### Added

- The repository: license, contributor agreement, community files, lint tooling and agent instructions. No product code yet.
- The spec format, version 0: the document, the JSON Schema of the front matter, and valid and invalid example specs, checked by `just lint`.
- The baseline lifecycle, version 0: where baselines live, how `fazon baseline update` writes them, and how the visual check treats them locally and in CI.
- The check catalogue, version 0: one rule sheet per check, and passing and failing HTML fixtures for the rendered checks.
- The story matrix rules, version 0: how stories are generated, produced, captured and named, the story manifest's JSON Schema, and the example specs' manifests.

# Security policy

## Reporting a vulnerability

Please report vulnerabilities through **GitHub private vulnerability reporting**: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/gergodrazsdik/fazon/security/advisories/new)). Do not open a public issue, pull request or discussion about it.

Include what you found, how to reproduce it, and the impact you expect.

## Scope

In scope:

- The repository's workflows, scripts and settings, for example a workflow that leaks secrets or can be triggered by an outside contributor.
- As they arrive: the CLI and harness, the agent permission rules it enforces, the verifier image, the reusable CI workflow and the Claude Code plugin, for example a way for a generated component or a spec to escape the paths the harness allows or to reach credentials.

Out of scope:

- Problems in an adopter's own configuration, credentials or hosting that Fazon's defaults don't cause.
- Vulnerabilities in dependencies that are already public and tracked upstream, unless Fazon uses them in an exploitable way.
- The behaviour of the AI models Fazon calls, beyond what Fazon's own checks and permissions are meant to contain.

## Supported versions

Fazon has no release yet. Before 1.0, only the latest `main` gets security fixes.

## Response

Fazon has a single maintainer, so responses are best effort. Fixed vulnerabilities are published as GitHub security advisories, with credit if you want it.

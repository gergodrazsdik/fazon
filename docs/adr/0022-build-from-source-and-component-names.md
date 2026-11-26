# 0022: The example repository builds the framework from source until M5; components carry a prefixed name

- Status: accepted
- Date: 2026-11-26
- Tracker: T-0046 (step 11), T-0095
- Supersedes: the pnpm git dependencies of [ADR 0016](0016-adapter-boundary.md)

## Context and problem statement

ADR 0016 planned that, until M5, the example repository consumes the CLI and the Vue adapter as pnpm git dependencies on the framework repository at one commit. Step 11 tried it with pnpm 12.22.0:

- a git dependency with a package path fails to resolve the packages' `workspace:*` dependencies on each other;
- overriding them with git specifications stops at pnpm's block on exotic sub-dependencies;
- with that block off, the packages install without their build, as `dist/` isn't in git and no package has a `prepare` script.

Step 11 also found that `vue/multi-word-component-names`, which the Vue adapter's ESLint configuration turns on, fails every single-word component name the specs use: Button, Badge, Link, Card, Tabs.

## Considered options

1. **Consuming the framework before M5:** build the pinned commit from source in the example repository; tarballs attached to a GitHub pre-release per framework commit; npm pre-release versions per commit.
2. **Single-word component names:** a prefixed internal name declared with `defineOptions`; the rule turned off.

## Decision outcome

The maintainer chose:

1. **Build from source.** A script in the example repository fetches the pinned commit into a gitignored `.fazon-framework/<sha>/` directory, installs it from its lockfile and builds it; `package.json` depends on the packages there with `file:` paths, and overrides `@fazon/core` and `@fazon/adapter-vue` to the same paths. The SHA in the path is the pin. Nothing is published, and the framework's CI doesn't change. It costs a framework build on every fresh install. npm pre-releases were ruled out as publishing before the publishing decision.
2. **A prefixed internal name.** Each component declares `defineOptions({ name })` with the token set's prefix in PascalCase before the component's name, such as `FzButton`, so devtools and recursive references never collide with an HTML element; consumers still import `Button`. The lint rule stays on.

### Consequences

- adapter-boundary.md describes the build-from-source pin and the name in the API mapping; ADAPTER-003 checks the commit in the `file:` paths, the workflow reference and the image.
- T-0095 puts the prefixed name into the Vue adapter's API mapping and its contract test, the conventions template and, in M2, the generation skill.
- From M5, the released packages replace the build, as ADR 0016 planned.

## More information

- [Adapter boundary: consuming the framework before M5](../spec/adapter-boundary.md#consuming-the-framework-before-m5)
- [fazon-vue-example#2](https://github.com/gergodrazsdik/fazon-vue-example/pull/2), where step 11 tried the options

@AGENTS.md

## Claude Code

Additions for Claude Code only; everything shared is in AGENTS.md (imported above, so it loads once whether or not Claude Code also loads `AGENTS.md` on its own).

- **Sandbox:** `.claude/settings.json` turns on the Bash sandbox with a network allowlist (GitHub, GHCR, the npm registry, PyPI, Playwright's browser downloads), sets `NODE_USE_ENV_PROXY=1` so Node's `fetch` (corepack, for one) goes through the sandbox's proxy, and denies reading or editing `.env*` files, keys, certificates and `secrets/`. Signing, SSH and the GitHub token aren't available inside it, so these run outside, as their own calls, as your user-level settings allow:
  - commits: `git commit -F <file>`, with the message in a file outside the repo;
  - pushing: `git push`;
  - GitHub: `gh` (pull requests with `gh pr create --body-file <file>`, `gh pr edit --body-file <file>`), and `just github-settings` / `just github-settings-check`;
  - installing dependencies: `pnpm install` (or `just install`). pnpm 12's store lock fails with "Read-only file system" inside the sandbox, wherever the store points;
  - containers: `podman` and `docker`, for example `just test-rendered` and `just test-verify`.

  A call only runs outside when the whole command matches: no `cd … &&`, pipes, heredocs, `$(...)` or redirections around it. Project settings can't add sandbox exclusions; they live in each user's own settings.
- **Start sessions with `just claude`** (extra arguments are passed through). When `fazon-vue-example` is cloned next to this repo, it adds that directory (`--add-dir ../fazon-vue-example`) and loads its CLAUDE.md, so work across both repos needs no sandbox exceptions for file edits there.
- **Subagents:** give each one its own git worktree and branch, explicit file ownership and its own pull request. Shared files (the tracker, AGENTS.md) belong to the main agent; subagents propose changes to them in their pull request description.
- **Check what loads:** `claude -p --permission-mode plan "list the instruction files in your context"` from the repo root.

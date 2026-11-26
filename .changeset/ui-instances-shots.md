---
"app": patch
---

Several rendered app instances run at once, one per worktree, with nothing shared: the e2e Server (now `scripts/ui-server.ts`) takes two ports the kernel picks together and boots again on a port another instance took. `pnpm ui-up` boots the built app on memory adapters (`--check` is the fast spin-up check: it prints the seconds to the first 200 and stops). `pnpm ui-shot` takes before and after screenshots at a device scale factor of 2 into a folder outside the repository, for a PR description. `docs/agents/ui.md` has the steps.

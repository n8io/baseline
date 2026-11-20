---
"app": minor
---

`pnpm dev:prune` removes the containers and volumes of the dev instances whose linked worktree is gone, so a worktree removed without `pnpm dev:reset` leaves nothing running. `pnpm dev:prune --dry-run` only lists them. An instance counts as gone when the folder compose ran it in no longer exists, its name is the one `pnpm dev` gives that folder, and no worktree git lists uses that name; so the original checkout's stack, another Project's, a moved worktree's and an instance renamed in `.env.development.local` stay. Volumes left by a `docker compose down` without `--volumes` are not found.

To upgrade a Project: run `pnpm template-upgrade`; it adds `scripts/dev-prune.ts` and the `dev:prune` script.

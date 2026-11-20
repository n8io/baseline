---
"app": minor
---

Each linked git worktree of a Project now runs `pnpm dev` as its own dev instance, so several worktrees run at once with no shared containers, volumes, data, ports or cookies. The first `pnpm dev` (or `pnpm dev:reset`) in a worktree writes its compose project, `<project>-<worktree folder>`, and its own ports to `.env.development.local`, once; edit a port there on a clash. `pnpm test:integration` in that worktree uses its Postgres and Redis. The original checkout keeps the Project's name, ports and data.

- `.env.schema` has a new `COMPOSE_PROJECT_NAME` (the Project's name), which `varlock run` hands to `docker compose`; compose commands no longer pass `-p`.
- With the UI, the dev server listens on `PORT` (no longer Vite's 5173) and fails if it is taken. Open the URL it prints, `http://<instance>.localhost:<PORT>/`, so each instance keeps its own sign-in.
- The dev Worker serves health on `HEALTH_PORT + 1`, which is the port it had.

To upgrade a Project: run `pnpm template-upgrade`. If `package.json` conflicts on `dev` or `dev:reset`, take the Template's scripts: your own Worker `HEALTH_PORT=<port>` is now `HEALTH_PORT + 1` from `.env.development`, so only an edited Worker port needs that `HEALTH_PORT` changed to one below it. Run compose by hand as `varlock run -- docker compose …`, without `-p`.

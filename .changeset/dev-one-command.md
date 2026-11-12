---
"app": minor
---

`pnpm dev` starts Postgres and Redis itself (`docker compose up -d --wait`), and the Worker restarts when a file it imports changes (`node --watch`), so an edited Consumer or Schedule takes effect without a manual restart.

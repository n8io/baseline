---
"app": minor
---

The production image runs on `node:26-alpine` in both stages, at the owner's choice after a comparison of slim, Alpine and distroless (#393). The Template's full render goes from 324 MB to 254 MB, and with every piece removed it goes from 302 MB to 232 MB. On the day of the change Trivy reported 1 OS vulnerability in the Alpine base and 210 in Debian slim. Native packages now install their musl builds, and a shell in the container is BusyBox `sh`, not `bash`. `image-budget.json` drops from 360 to 280 MB.

To upgrade a Project: run `pnpm template-upgrade`; it takes `Dockerfile`, `dockerfile.test.ts`, `docs/agents/deploy.md` and `image-budget.json`. A Project that set its own budget gets a conflict in `image-budget.json`: keep yours, then lower it to your next `image` job's `Image: N MB` plus about 10%. A Project with a production dependency that ships only a glibc native binary keeps `node:26-slim` (keep both `FROM` lines, the test and your `image-budget.json`). Rebuild the image and run your deploy checks; a script or health check that calls `bash` inside the container needs `sh`.

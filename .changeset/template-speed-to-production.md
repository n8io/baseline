---
app: major
---

Faster path from a new Project to production. `pnpm app-create --without a,b` removes Pieces at create time. The Template adds an optional `image-publish.yml` (pushes the image to ghcr.io on a `v*` tag) and `deploy/kubernetes.yaml`. Breaking for the shared CI: on a pull request, the eleven `piece (...)` jobs now run only when the diff touches a manifest, the piece tooling or a piece marker (and still on every nightly, dispatch and non-pull-request run), so the `pieces` check can pass without them. The Template's allowlist now records why drizzle is on a release candidate (with an exit) and why react-router-hono-server stays.

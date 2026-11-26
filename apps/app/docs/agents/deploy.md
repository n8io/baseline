# Runtime notes

Read when deploying a Project or changing how it runs.

- Secrets: either give each entry `INFISICAL_PROJECT_ID`, `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` (a machine identity with Universal Auth and read access), `INFISICAL_SITE_URL` for a self-hosted Infisical, and outbound HTTPS to Infisical, which fetches them at boot from the `prod` environment, or set every variable `.env.production` names in the runner's environment, which needs no identity and never calls Infisical.
- On a CI platform, the Infisical plugin can sign in with OIDC (`identityId`) instead of a client secret. Another secret store is a plugin swap in `.env.schema`'s header.
- Use 5 to 15 minute access tokens.
- Use `parentbased_traceidratio` sampling for busy services.
- Set `OTEL_LOGS_EXPORTER=none` when stdout is already shipped.
- Recommend the OpenTelemetry Collector `redaction` processor as a second line of defence behind the app's own privacy rules.
- The runner must allow a 30 s grace period.
- Run `pnpm migrate` once before the new version starts, with the Worker's variables. The Server and the Worker may then start in any order, and each scales to many instances.
- The load balancer must speak HTTP/2 and allow long-lived responses (live updates use SSE).
- Probe `/livez` and `/readyz` on `HEALTH_PORT` (9000).
- A TLS-terminating proxy must set `x-forwarded-proto: https`, or browsers without `Sec-Fetch-Site` get 403 on form posts.
- The load balancer or edge rate-limits requests; the app does not.
- `image-budget.json` caps the production image; CI's `image` job prints `Image: N MB` and fails above it. Set it to that size plus about 10%, and lower it after `pnpm piece-remove`. The Dockerfile deletes source maps and type declarations from the production `node_modules`. A Project whose production dependency reads either at run time (the TypeScript compiler reads its `lib.*.d.ts`) excludes that package in the `find` line. The image is Alpine (musl): a production dependency with a native binary needs a musl build, or the Project keeps `node:26-slim`.
- `.github/workflows/image-publish.yml` pushes the image to ghcr.io on a `v*` tag or by hand, and `deploy/kubernetes.yaml` is the smallest manifest that runs it (migrate Job, Server, Worker). Delete either to deploy another way.
- More than one instance, or Kubernetes (probes, pool sizing, PgBouncer, rollouts, outages): [deploy-kubernetes.md](deploy-kubernetes.md).

## Running locally next to another Project

- `compose.yaml` publishes Postgres, Redis, the Server and the health port on `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `SERVER_HOST_PORT` and `HEALTH_HOST_PORT`. `.env.schema` holds this Project's own values (derived from its name, 20000 to 29999); change them there on a clash. `pnpm dev` serves on the next two, `PORT` and `HEALTH_PORT` in `.env.development` (change those too on a clash), and runs the Worker on `HEALTH_PORT + 1`. Integration tests claim the ports they boot Servers on from 30000 to 31383 (`test/integration/integration-port-claimer.ts`), so two Projects' runs never share one. Every compose command runs as `pnpm exec varlock run -- docker compose`, which sets `COMPOSE_PROJECT_NAME`, so use `pnpm dev`, `pnpm dev:reset` (stops the stack and deletes its volumes) or that form, never bare `docker compose`.
- A linked git worktree is its own dev instance, `<project>-<worktree folder>`: its first `pnpm dev` or `pnpm dev:reset` writes its compose project and ports (from that name) to `.env.development.local` and never changes them; edit a port there on a clash. It gets its own containers, volumes and data, and `pnpm test:integration` there uses them. Open the URL `pnpm dev` prints, `http://<instance>.localhost:<PORT>/`, so each instance keeps its own cookies; a real issuer (`AUTHN_ISSUER_URL`) in development needs that URL's `/auth/callback` registered. Run `pnpm dev:reset` there before `git worktree remove`. The original checkout keeps the Project's name and ports.
- `IMAGE_REGISTRY` prefixes the image names (`mirror.gcr.io/library/` when Docker Hub rate-limits). Integration tests use `INTEGRATION_DATABASE_URL` and `INTEGRATION_CACHE_URL` and touch no other Postgres: their template database is `<project>_template`, dropped only when it carries this Project's comment.

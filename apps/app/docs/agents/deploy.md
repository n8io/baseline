# Runtime notes

Read when deploying a Project or changing how it runs.

- Secrets: either give each entry `OP_SERVICE_ACCOUNT_TOKEN` and outbound HTTPS to 1Password, which fetches them at boot, or set every variable `.env.production` names in the runner's environment, which needs no token and never calls 1Password.
- Use 5 to 15 minute access tokens.
- Use `parentbased_traceidratio` sampling for busy services.
- Set `OTEL_LOGS_EXPORTER=none` when stdout is already shipped.
- The runner must allow a 30 s grace period.
- Run `pnpm migrate` once before the new version starts, with the Worker's variables. The server and the Worker may then start in any order, and each scales to many instances.
- The load balancer must speak HTTP/2 and allow long-lived responses (live updates use SSE).
- Probe `/livez` and `/readyz` on `HEALTH_PORT` (9000).
- A TLS-terminating proxy must set `x-forwarded-proto: https`, or browsers without `Sec-Fetch-Site` get 403 on form posts.
- The load balancer or edge rate-limits requests; the app does not.
- More than one instance, or Kubernetes (probes, pool sizing, PgBouncer, rollouts, outages): [deploy-kubernetes.md](deploy-kubernetes.md).

## Running locally next to another Project

- `compose.yaml` publishes Postgres, Redis, the Server and the health port on `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `SERVER_HOST_PORT` and `HEALTH_HOST_PORT`. `.env.schema` holds this Project's own values (derived from its name, 20000 to 29999); change them there on a clash. Every compose command runs as `varlock run -- docker compose -p <project>`, so use `pnpm dev`, `pnpm dev:reset` (stops the stack and deletes its volumes) or that form, never bare `docker compose`.
- `IMAGE_REGISTRY` prefixes the image names (`mirror.gcr.io/library/` when Docker Hub rate-limits). Integration tests use `INTEGRATION_DATABASE_URL` and `INTEGRATION_CACHE_URL` and touch no other Postgres: their template database is `<project>_template`, dropped only when it carries this Project's comment.

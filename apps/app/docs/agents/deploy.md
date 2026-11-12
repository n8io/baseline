# Runtime notes

Read when deploying a Project or changing how it runs.

- Give each entry `OP_SERVICE_ACCOUNT_TOKEN` and outbound HTTPS to 1Password. Secrets are fetched at boot.
- Use 5 to 15 minute access tokens.
- Use `parentbased_traceidratio` sampling for busy services.
- Set `OTEL_LOGS_EXPORTER=none` when stdout is already shipped.
- The runner must allow a 30 s grace period.
- Run `pnpm migrate` once before the new version starts. The server and the Worker may then start in any order.
- The load balancer must speak HTTP/2 and allow long-lived responses (live updates use SSE).
- Probe `/livez` and `/readyz` on `HEALTH_PORT` (9000).
- A TLS-terminating proxy must set `x-forwarded-proto: https`, or browsers without `Sec-Fetch-Site` get 403 on form posts.
- The load balancer or edge rate-limits requests; the app does not.
- After `pnpm template-upgrade`, resolve every conflict marker before committing.

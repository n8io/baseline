---
"app": minor
---

Production can boot without calling 1Password, and a Kubernetes deploy guide says how to run many pods.

- `OP_SERVICE_ACCOUNT_TOKEN` is no longer required in production. A variable already set in the environment wins over its `op()` reference in `.env.production` and is never fetched, so a runner that sets every one of them (a Kubernetes Secret synced from the vault, for example) boots with no token and no call to 1Password. With a token nothing changes. With no token, a reference that is not set fails the boot and names the variable.
- New `docs/agents/deploy-kubernetes.md`: roles, probes, pool sizing with a worked 12-pod example, PgBouncer, secrets, graceful shutdown, the load balancer idle timeout, rolling deploys, Redis outages, Event order and blocked Event keys, Redis high availability, Pulsar, alerts, known gaps and example manifests.

To upgrade a Project: in `.env.schema` change the line above `OP_SERVICE_ACCOUNT_TOKEN=` from `# @required=forEnv(production)` to `# @required=false`, and copy `docs/agents/deploy-kubernetes.md` with its line in `AGENTS.md`.

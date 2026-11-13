# @n8io/baseline-health

## 2.0.1

### Patch Changes

- 31cc578: Outlast the load balancer's idle timeout, and stop tracing idle polls.
  - http: `httpServerKeepAlive(server)` keeps idle connections open for 65 s (Node's default is 5 s) and gives headers 66 s. A load balancer with the usual 60 s idle timeout no longer reuses a connection the pod has closed, which the client saw as an occasional 502. Keep the balancer's idle timeout under 65 s.
  - app: `src/server.ts` calls `httpServerKeepAlive(server)` first in `serverServe`. A Project adds that line and its import on upgrade.
  - health: the probe server keeps idle connections for 65 s too, and `close()` now drops every open connection, so a half-sent probe cannot hold shutdown.
  - telemetry: pg and Redis spans are made only inside a trace (`requireParentSpan`). A query in a request, a Consumer or Schedule run or a use case keeps its span; a queue poll, boot or maintenance query makes none. Redis still makes one `redis-connect` span per connection it opens. pg's metrics follow its spans: `db.client.operation.duration` counts only queries inside a trace, and a pool's `db.client.connection.*` metrics start with its first query inside a trace.

## 2.0.0

### Major Changes

- a61f217: Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

  Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

  In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.

## 1.1.0

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

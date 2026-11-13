# Vendor settings

Read when a Project needs a setting only the vendor behind a Package has: TLS for Postgres, a Mixpanel region, a Pulsar login the Package does not name.

A Package's own options are its contract: they keep working when the vendor behind it changes. Everything else reaches the vendor in one of two ways, and only from the wiring files, `src/connections.ts` and `src/*-open.ts`.

## The client is yours

Where the vendor has a client object, the wiring file builds it and hands it to the Package, so every setting of the client is open to you. Redis works this way: `src/redis.ts` calls node-redis's `createClient`, and `cacheStoreRedisCreate(redis)` and `liveHubRedisCreate(redis)` take the result. The queue takes the Postgres pool the same way.

## The `vendor` option

Where the Package has to build the vendor's client itself, its factory takes one more option, always named `vendor`, typed as the vendor's own settings and passed straight through:

```ts
// src/connections.ts
postgresPoolCreate({
	databaseUrl: env.DATABASE_URL,
	vendor: { idleTimeoutMillis: 30_000, ssl: { ca } },
});
```

| Factory                   | `vendor` is                  | Where to call it        |
| ------------------------- | ---------------------------- | ----------------------- |
| `postgresPoolCreate`      | pg's pool settings           | `src/connections.ts`    |
| `queueCreate`             | pg-boss's settings           | `src/queue-open.ts`     |
| `pulsarCreate`            | the Pulsar client's settings | `src/events-open.ts`    |
| `analyticsMixpanelCreate` | Mixpanel's settings (`host`) | `src/analytics-open.ts` |

Rules:

- A named option wins. `vendor` refuses the keys a named option sets, and the ones the Package depends on, with an error that names the option to use.
- `vendor` is outside the contract. The Package does not test it, and a vendor swap deletes it. Search for `vendor:` to see what a swap must solve again.
- Never reach a vendor from a Domain or the UI. Architecture rule A12 refuses these factories there. For a vendor-only call at run time (a Redis command, say), write an adapter of your own in `spi/` behind a Domain port, built on the client the wiring file holds.
- The logger and telemetry have no `vendor` option: both start from the environment before any wiring runs.
- A setting every Project needs is not a `vendor` setting. Ask for a named option.

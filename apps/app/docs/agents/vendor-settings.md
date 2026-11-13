# Vendor settings

Read when a Project needs a setting only the vendor behind a Package has: TLS for Postgres, a Mixpanel region, a Pulsar login the Package does not name.

A Package's named options keep working when the vendor behind it changes. Everything else reaches the vendor in one of two ways, and only from `src/connections.ts`, `src/redis.ts`, the `src/*-open.ts` files and `src/migrate.ts`.

## You build it

Where the vendor hands out an object to talk to it, your file builds that object and passes it to the Package, so every setting is open to you. Redis works this way: `src/redis.ts` calls node-redis's `createClient`, and `cacheStoreRedisCreate({ redisClient })` and `liveHubRedisCreate({ redisClient })` take the result. The queue takes the Postgres pool the same way.

## The `vendor` option

Where the Package has to build that object itself, its factory takes one more option, always named `vendor`, typed as the vendor's own settings and passed straight through:

```ts
// src/connections.ts
postgresPoolCreate({
	databaseUrl: env.DATABASE_URL,
	vendor: { idleTimeoutMillis: 30_000, ssl: { ca } },
});
```

| Factory                           | `vendor` is                                     | Where to call it             |
| --------------------------------- | ----------------------------------------------- | ---------------------------- |
| `postgresPoolCreate`              | pg's pool settings                              | `src/connections.ts`         |
| `postgresMigrate`, `queueMigrate` | the same, for the migration's own connection    | `src/migrate.ts`             |
| `queueCreate`                     | pg-boss's intervals, warnings and retention     | `src/queue-open.ts`          |
| `pulsarCreate`                    | the Pulsar library's settings                   | `src/events-open.ts`         |
| `analyticsMixpanelCreate`         | Mixpanel's settings (`host`)                    | `src/analytics-open.ts`      |
| `errorTrackingSentryCreate`       | Sentry's init options (`release`, `sampleRate`) | `src/error-tracking-open.ts` |

Rules:

- A named option wins. `vendor` throws on a key that a named option sets, that the Package depends on, or that would do nothing, and the error says where the setting belongs.
- Postgres reads TLS from one place. With `sslmode` or another `ssl*` parameter in `DATABASE_URL`, pg ignores `vendor.ssl`, so the Package refuses the pair. A Project that sets `vendor.ssl` on the pool passes the same to `postgresMigrate` and `queueMigrate`.
- Leave a key out to leave it unset. `vendor: { ssl: undefined }` is a type error; spread it in instead: `vendor: { ...(ca ? { ssl: { ca } } : {}) }`.
- `vendor` is outside what the Package promises. The Package does not test it, and a vendor swap deletes it. Search for `vendor:` to see what a swap must solve again.
- Never reach a vendor from a Domain, the UI or a composition root. Architecture rule A12 allows these factories only in the files named above. For a vendor-only call at run time (a Redis command, say), write an adapter of your own in `spi/` behind a Domain port, built on what `connections` holds.
- The logger and telemetry have no `vendor` option: both start from the environment before any of these files run.
- A setting every Project needs is not a `vendor` setting. Ask for a named option.

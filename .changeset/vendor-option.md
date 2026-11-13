---
"@n8io/baseline-postgres": minor
"@n8io/baseline-queue": minor
"@n8io/baseline-pulsar": minor
"@n8io/baseline-analytics": minor
"@n8io/baseline-cache": major
"@n8io/baseline-live": major
"app": major
---

Vendor-only settings have one way in. `postgresPoolCreate`, `postgresMigrate`, `queueCreate`, `queueMigrate`, `pulsarCreate` and `analyticsMixpanelCreate` take a `vendor` option, typed as the vendor's own settings and passed through: `ssl` for Postgres, pg-boss's tuning, OAuth2 or mTLS for Pulsar, Mixpanel's `host` for data residency. A Package's named options win, and `vendor` throws on the keys they set and on the ones that would do nothing. `vendor` is outside each Package's contract: it is not tested, and a vendor swap deletes it.

In the Template, `docs/agents/vendor-settings.md` says when to use it, and architecture rule A12 allows the vendor factories only in `src/connections.ts`, `src/redis.ts` and the `src/*-open.ts` files.

A factory that is one vendor's takes one options object: `analyticsMixpanelCreate({ token, vendor? })`, `cacheStoreRedisCreate({ redisClient })` and `liveHubRedisCreate({ redisClient })` replace their positional forms. When you upgrade, wrap the argument of those three calls.

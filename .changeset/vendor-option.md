---
"@n8io/baseline-postgres": minor
"@n8io/baseline-queue": minor
"@n8io/baseline-pulsar": minor
"@n8io/baseline-analytics": minor
"app": minor
---

Vendor-only settings have one way in. `postgresPoolCreate`, `queueCreate`, `pulsarCreate` and `analyticsMixpanelCreate` take a `vendor` option, typed as the vendor's own settings and passed through: `ssl` for Postgres, pg-boss's tuning, OAuth2 or mTLS for Pulsar, Mixpanel's `host` for data residency. A Package's named options win, and `vendor` throws on the keys they set. `vendor` is outside each Package's contract: it is not tested, and a vendor swap deletes it.

In the Template, `docs/agents/vendor-settings.md` says when to use it, and architecture rule A12 refuses `analyticsMixpanelCreate(`, `liveHubRedisCreate(` and `pulsarCreate(` in a Domain or the UI, so vendor settings stay in `src/connections.ts` and the `src/*-open.ts` files.

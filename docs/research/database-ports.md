# Drizzle and the pg pool behind the database ports

Follow-up to [atomic-writes.md](atomic-writes.md). Researched 2026-11-01. Evidence tags: **[tested]** I ran it, **[source]** read in the owner's docs or source, **[inferred]** reasoned, not run.

Code: [`database-ports/`](database-ports/). Output: [`database-ports/results/`](database-ports/results/). **The sections below were written against stable `drizzle-orm` 0.45.4** (code at commit 5907ce5). The code on this branch tip now runs on Drizzle 1.0 rc.5; read [Drizzle 1.0 rc](#drizzle-10-rc) first. Versions for the 0.45.4 runs: `drizzle-orm` 0.45.4 (npm `latest`), `drizzle-kit` 0.31.11, `pg` 8.23.1, `pg-pool` 3.14.0, `instrumentation-pg` 0.77.0, TypeScript 7.0.2, Postgres 18.6. Node 26.10.0 and 24.19.0 both pass all 24 checks.

## Short answer

Drizzle works on the checked-out client. Build `drizzle(guardedClient)` inside `postgresTransaction`, one per transaction. Commit, rollback, the closed-scope guard, `23505` mapping and OTel spans all behave as with raw `pg`. [tested]

- Drizzle 1.0 is **not stable**. `latest` is 0.45.4; 1.0 is `1.0.0-rc.5` on the `rc` tag. I also ran the main checks on rc.5: they pass, but the constructor changed (see surprises). [tested]
- Surprises:
  1. Drizzle wraps every driver error, **including the closed-scope guard's error**, in `DrizzleQueryError`. The text you see is `Failed query: ...`; the real message and `code` are on `.cause`. Guard tests and `23505` detection must read `.cause`. [tested]
  2. **`pgPool.end()` never settles callers still waiting for a connection** when `connectionTimeoutMillis` is unset. They hang forever. With it set, they fail at their own timeout. [tested]
  3. In pg 8.23.1 a `?connect_timeout=` in the connection string is **ignored**, and `keepAlive` is off by default. [tested]
  4. Drizzle 1.0 rc.5 no longer takes a client as the first argument: `drizzle({ client })`. [tested]
- Recommendation for the pool: set `connectionTimeoutMillis` to about 3000 (never above 5000), keep `max` explicit, set `keepAlive: true`. Reasons under Q8.
- The cost of `drizzle(client)` per transaction is 0.43 microseconds. Create it per transaction. [tested]

## Drizzle 1.0 rc

The user chose 1.0. Newest rc on npm today (2026-11-01): `drizzle-orm` and `drizzle-kit` both `1.0.0-rc.5` (the `rc` tag; `latest` is still 0.45.4 and 0.31.11). Branch tip runs on them. Full suite, 24 checks, on Node 26.10.0 and 24.19.0 against Postgres 18.6: **all pass** ([26.10.0](database-ports/results/drizzle-1.0.0-rc.5/node-26.10.0.txt), [24.19.0](database-ports/results/drizzle-1.0.0-rc.5/node-24.19.0.txt)). [tested]

| Check | Result on rc.5 |
|---|---|
| Commit, err rollback, throw rollback, SQL error rollback | pass |
| Closed-scope guard (Proxy) | pass; error still wrapped in `DrizzleQueryError`, text in `.cause.message` |
| 400 mixed transactions on a pool of 2 | pass: 80 of each kind, 2 idle sessions, none idle in transaction |
| 23505 shape | still `DrizzleQueryError` with `.cause` = pg `DatabaseError` (`code`, `constraint`, `table`, `detail`). The detection code is unchanged |
| 10 concurrent same name, and the barrier case | 1 ok, rest `FooNameTakenError` |
| Pool reads, OTel (80 spans, 0 foreign), pool exhaustion, `end()`, plain `pg` | pass, same numbers |
| `drizzle({ client })` cost | 0.43 us; with Proxy 0.25 us; about 1,010 bytes per instance |
| Typecheck, TS 7.0.2 with `exactOptionalPropertyTypes` | clean |
| drizzle-kit with `schema: "./src/domains/*/spi/*-table.ts"` | generate runs, finds both tables, ignores `bar-repository.ts`, follows `../../foo/spi/foo-table.ts` imports, works with `--no-experimental-strip-types` ([output](database-ports/results/drizzle-1.0.0-rc.5/kit-output/)) |

**Repository parameter type.** `type Database = NodePgDatabase` works (it now has a default `EmptyRelations` generic). `ReturnType<typeof drizzle>` no longer works, as before. A `PoolClient` is accepted by `drizzle({ client })`: the option is `client: TClient extends NodePgClient` (`Pool | PoolClient | Client`). [tested, source]

**(a) Narrowing out `transaction`.** `type Database = Omit<NodePgDatabase, "transaction">` type-checks, the full instance is assignable to it, and `select`, `insert` and `execute` still type-check and run: the whole suite passes with the repository using it. A call to `db.transaction(...)` on it is a compile error ([compile-checks/database-type.compile.ts](database-ports/compile-checks/database-type.compile.ts), `@ts-expect-error` holds). It is a type-level block only; the method still exists at run time. [tested]

**(b) `drizzle(pgPool)` for reads.** No change in behavior. Queries go through `client.query({ text, ... }, params)` on the pool (a pool query, no checkout by Drizzle). Only `db.transaction()` checks a client out of a pool (`NodePgSession.transaction`). Reads ran outside any transaction and did not see uncommitted rows. The constructor is `drizzle({ client: pgPool })`; the `Pool` type is the default for the `client` option. [tested, source]

**(c) API differences from 0.45.4 that a repository or table file hits**

| Area | 0.45.4 | 1.0.0-rc.5 | Tag |
|---|---|---|---|
| Constructor with a client or pool | `drizzle(pgPool)`, `drizzle(pgClient)` | `drizzle({ client })`. The positional form is a type error, and at run time the client is read as a config object (`ERR_INVALID_ARG_TYPE`) | tested |
| Error params | `DrizzleQueryError.params` set, message ends with `params: ...` | `params` is `undefined` and absent from the message unless `drizzle({ client, paramsInErrors: true })` | tested, [docs](https://orm.drizzle.team/docs/v0-v1-changes) |
| Error shape | own keys `query, params, cause` | `query, params, cause, name`; `.cause` still the driver error | tested |
| `db.execute()` result | `QueryResult` with `.rows` | typed as `QueryResult \| QueryResult[]` (`NodePgRawExecuteResult`), so `.rows` needs narrowing | tested |
| `$client` type | pool-typed unless set | `PoolClient` when you pass one | tested |
| Table file | `pgTable(name, cols, (t) => [...])`, `uuid().primaryKey()`, `uniqueIndex().on()`, `primaryKey({ columns })`, `.references(() => t.id)` | unchanged; the same `foo-table.ts` compiles and generates | tested |
| Query builder | `select().from().leftJoin().where().groupBy()`, `insert().values()`, `eq`, `sql<T>` | unchanged for all calls in the repository | tested |
| Generated SQL (drizzle-kit) | `"id" uuid PRIMARY KEY NOT NULL`, `foo_tag_foo_id_tag_pk`, `..._fk`, `"public"."foo"`, `ON DELETE no action` | `"id" uuid PRIMARY KEY`, `foo_tag_pkey`, `..._fkey`, `"foo"`, no `ON DELETE` clause. Primary key columns drop the explicit `NOT NULL` (implied) | tested |
| Migration folder | `drizzle/0000_init.sql` plus `meta/_journal.json` | `drizzle/<timestamp>_init/migration.sql` and `snapshot.json`; no journal; `drizzle-kit drop` removed | tested, source |
| Upgrade existing migrations | n/a | `drizzle-kit up` | source |
| Cost of building one select | 15 us | 1.6 us | tested |
| Relational queries | RQB v1 (`db.query`) | v1 removed; `defineRelations()` and `relations` on the driver (`NodePgDatabase<TRelations>`). The repository does not use them | source |
| Other documented breaks that this repository does not hit | | `getTableColumns` is deprecated for `getColumns`; `.enableRLS()` for `pgTable.withRLS`; `.array()` is not chainable; `generatedAlwaysAs` takes `sql`; `casing` option replaced by `snakeCase`/`camelCase` helpers; validators move into `drizzle-orm/zod` etc.; `schemaFilter` default is now all schemas; `push --strict` removed | source ([v0 to v1 changes](https://orm.drizzle.team/docs/v0-v1-changes), [upgrade](https://orm.drizzle.team/docs/upgrade-v1)) |

**Surprises**
1. `params` are now left out of `DrizzleQueryError` by default. Good for logs, but anything that read `error.params` gets `undefined`.
2. drizzle-kit 1.0 emits different constraint names (`_pkey`, `_fkey`) and a new migration folder layout, so a project moving from 0.31 gets rename statements unless it runs `drizzle-kit up` and checks the diff. Not tested.
3. It is a release candidate: the typings and the migration format changed between beta.22 and rc.5 per the docs, and can change again.

Not verified on rc.5: `paramsInErrors: true` at run time (read in source only), `drizzle-kit up` on 0.31 output, `push` and `migrate` against a database.

## Checks (stable 0.45.4)

| # | Check | Result | Tag |
|---|---|---|---|
| 1 | Commit on ok, both tables | pass | tested |
| 1 | Rollback on err after a write | pass | tested |
| 1 | Rollback on throw | pass | tested |
| 1 | SQL error mid-transaction (check constraint) rolls back foo row | pass | tested |
| 1 | Closed-scope guard (Proxy on the client) | pass, error arrives wrapped | tested |
| 1 | Control: no guard, a kept Drizzle instance writes on a released client | writes succeed | tested |
| 1 | 400 mixed transactions, pool of 2 | 80 of each kind; 2 sessions, both `idle`; none idle in transaction | tested |
| 2 | Unique violation shape | `DrizzleQueryError`, driver error in `.cause` | tested |
| 2 | Other unique constraint (primary key) not mapped | pass | tested |
| 2 | 10 concurrent same-name creates | 1 ok, 9 `FooNameTakenError` | tested |
| 2 | 2 creates, both transactions open before either inserts | 1 ok, 1 `FooNameTakenError` | tested |
| 3 | Read repository on `drizzle(pgPool)` | outside a transaction; does not see uncommitted rows | tested |
| 4 | OTel, 10 requests, pool of 1 | all pg spans under own request; 0 in another trace | tested |
| 5 | Cost of `drizzle(client)` | 0.43 us each; 0.27 us with the Proxy | tested |
| 6 | `pnpm typecheck` with TS 7.0.2 | clean | tested |
| 6 | Running .ts under type stripping with Drizzle | no problem | tested |
| 7 | Plain `pg` repository, same checks | pass | tested |
| 8 | Pool exhaustion and `connectionTimeoutMillis` | see Q8 | tested |
| 9 | `schema: "./src/domains/*/spi/*-table.ts"` in drizzle-kit | works | tested |

## Details

### Q1. Drizzle bound to the checked-out client

`postgresTransaction` is the earlier `pgTransaction`, renamed, plus `SET LOCAL transaction_timeout` ([shared/postgres-transaction.ts](database-ports/shared/postgres-transaction.ts)). The repository takes the client and builds Drizzle on it:

```ts
fooRepository(drizzle(postgresClientScoped(pgClient, scope)))
```

The guard is a `Proxy` around the `PoolClient` whose `query` throws once `scope.open` is false. It keeps the `PoolClient` type, so no cast is needed. Drizzle only calls `client.query(...)` ([node-postgres/session.js](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/node-postgres/session.ts)), and it decides "is this a pool" by `instanceof Pool` or a constructor name containing `Pool`; a Proxy of a client is not one. [source, tested]

- A repository kept after the transaction, and a write started inside but run after it ended, both fail and write nothing. Without the guard the same write succeeds on the released client. [tested]
- The guard's error arrives as `DrizzleQueryError` with message `Failed query: insert ...`. The text "Repository used after its transaction ended" is in `.cause.message`. [tested]
- Type detail: `ReturnType<typeof drizzle>` is typed as pool-backed, so passing it a `PoolClient` fails under `exactOptionalPropertyTypes`. Type the repository parameter as `NodePgDatabase` instead. [tested]
- Drizzle's `db.transaction()` exists on a client-bound instance. It would issue a nested BEGIN. Nothing in the types stops a repository author from calling it. A lint rule or a narrower type is needed. [inferred]
- The aggregate read uses `sql<string[]>` for the `array_agg` of tags. Drizzle types it; it does not check it at run time. [tested]

### Q2. 23505 through Drizzle

Exact shape on 0.45.4 ([drizzle-bound.test.ts](database-ports/tests/drizzle-bound.test.ts), output in [results](database-ports/results/drizzle-0.45.4/node-26.10.0.txt)):

```
class DrizzleQueryError (extends Error)
message  "Failed query: insert into \"foo\" (\"id\", \"name\") values ($1, $2)\nparams: <uuid>,shape"
own keys query, params, cause
cause    DatabaseError  code "23505"  constraint "foo_name_unique"  table "foo"
         detail "Key (name)=(shape) already exists."
         message "duplicate key value violates unique constraint \"foo_name_unique\""
```

`code` is not on the wrapper. Detection used in the repository:

```ts
for (let e = error, i = 0; e && i < 5; e = e.cause, i++) {
  if (e.code === "23505" && e.constraint === "foo_name_unique") return true;
}
```

It walks `.cause`, so it also works if a later version stops wrapping. `DrizzleQueryError.cause` is typed `Error | undefined`, so TypeScript needs a cast to read `code`. A duplicate primary key reports `constraint: "foo_pkey"` and is rethrown, not mapped. Returning `err(FooNameTakenError)` makes `postgresTransaction` send ROLLBACK, which is needed because Postgres has aborted the transaction. [tested]

On 1.0.0-rc.5 the shape is the same (`DrizzleQueryError`, `.cause` is `DatabaseError`); `params` is `undefined` on the error and `name` is an own key. [tested]

### Q3. Read repository on the pool

`fooReadRepositoryPostgres(pgPool)` = `fooRead(drizzle(pgPool))`. While another request held an open transaction with an uncommitted `foo`, a pool read returned `undefined` for it, and `current_setting('transaction_timeout')` was `0` (the transaction's 5 s is `SET LOCAL`, so it does not leak). [tested]

### Q4. OTel

Same setup as the earlier test. Per request: `pg-pool.connect | BEGIN | SET | INSERT | INSERT | COMMIT | pg-pool.connect | SELECT` (the second pair is the pool read). 80 pg spans, all in their own request's trace and under its span, 0 elsewhere. The Proxy does not hide the call from `instrumentation-pg`, and the insert span carries `db.query.text` with Drizzle's SQL. Same result on rc.5. [tested]

### Q5. Cost and state

10,000 iterations, Node 26.10.0, no database ([bench.test.ts](database-ports/tests/bench.test.ts)):

| | each |
|---|---|
| `drizzle(client)` | 0.43 us |
| `drizzle(proxy(client))` | 0.27 us |
| reuse | 0.01 us |
| build one select with a reused `db` | 15 us (0.45.4), 1.6 us (rc.5) |

About 760 bytes of heap per instance (1,010 on rc.5). The instance holds `dialect`, `session`, `logger`, the client and a `NoopCache`. No query cache, prepared statement or connection state. The only state that matters is the client reference, which is why a kept instance is dangerous and the guard is needed. [tested, source]

### Q6. Types and type stripping

- `pnpm typecheck` (TS 7.0.2, `strict`, `erasableSyntaxOnly`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) passes with `skipLibCheck: true`. [tested]
- With `skipLibCheck: false` it fails inside Drizzle's `.d.ts` for dialects we do not use (`gel` not installed). Keep `skipLibCheck: true`. [tested]
- Drizzle ships compiled `.js`/`.cjs` plus `.d.ts`, no `.ts` source, so type stripping never touches it. All tests run `.ts` directly on Node 24 and 26. [tested]
- rc.5 typing: `drizzle({ client: pgClient })` runs correctly with a `PoolClient`, and a `PoolClient` type-checks there too. `db.execute()` results no longer have `.rows` typed. [tested]

### Q7. Plain SQL comparison

| | lines |
|---|---|
| [`foo-repository.pg.ts`](database-ports/foo/spi/foo-repository.pg.ts), plain `pg` | 42 |
| [`foo-repository.postgres.ts`](database-ports/foo/spi/foo-repository.postgres.ts), Drizzle | 64 |
| [`foo-table.ts`](database-ports/foo/spi/foo-table.ts) (Drizzle only) | 18 |
| [`foo-schema.sql`](database-ports/foo/spi/foo-schema.sql) | 7 |

The Drizzle count is larger because it is formatted one clause per line and has a `23505` helper (7 lines). The plain version has long lines. With Drizzle the table file replaces the hand-written SQL schema once migrations exist (drizzle-kit generates the SQL). [tested, inferred]

Row to model: plain `pg` returns `any` rows and the repository casts (`as Foo | undefined`). Drizzle returns typed rows from the table, and the aggregate `sql<string[]>` is a cast too. Neither validates at run time. A Zod `parse` of the row is needed in either case if the model schema must be enforced at the boundary; Drizzle does not remove that. I did not add Zod here. [inferred]

### Q8. Pool sizing and `connectionTimeoutMillis`

Defaults in the installed code, checked with [defaults-probe.ts](database-ports/tests/defaults-probe.ts):

| Option | Effective default | Where |
|---|---|---|
| `max` | 10 | pg-pool `index.js` line 89 |
| `idleTimeoutMillis` | 10000 | pg-pool line 98. `pg/lib/defaults.js` says 30000 but the pool does not use it |
| `connectionTimeoutMillis` | 0 (wait forever) | pg-pool line 206 |
| `query_timeout` | off | `defaults.js` |
| `statement_timeout` | off | `defaults.js` |
| `keepAlive` | **off** (`c.keepAlive \|\| false`, client.js line 95). `defaults.js` lists `keepalives: 1` but the socket option is what is used | client.js, connection.js line 48 |
| `maxLifetimeSeconds` | 0 (off) | pg-pool line 93 |
| `allowExitOnIdle` | false | pg-pool line 92 |

The [node-postgres docs](https://node-postgres.com/apis/pool) agree for `max` (10), `idleTimeoutMillis` (10000), `connectionTimeoutMillis` ("0 which means no timeout") and `maxLifetimeSeconds` (disabled). [source]

Connection string keys that `pg` reads: `statement_timeout`, `query_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `application_name`. It does **not** read `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` or `keepalives` from the string, and `?connect_timeout=7` is parsed but then overwritten from `connectionTimeoutMillis` (default 0 or `PGCONNECT_TIMEOUT`). Set pool options in code. [tested, source]

Exhaustion test: pool max 2, three transactions, each holds its client ([pool.test.ts](database-ports/tests/pool.test.ts)):

| `connectionTimeoutMillis` | hold | third caller | `pg-pool.connect` span for it |
|---|---|---|---|
| unset | 1 s / 2 s | waits, then succeeds at about 2 s / 4 s | ok, 1.0 s / 2.0 s long |
| 1000 | 1 s | fails at 1004 ms (tie with the release; timeout wins) | status ERROR, `timeout exceeded when trying to connect`, with an `exception` event |
| 1000 | 2 s | fails at 1002 ms | same |
| 5000 | 1 s / 2 s | waits, succeeds | ok |

- The error is a plain `Error` (class `Error`, not a subclass) with message `timeout exceeded when trying to connect`. Detect it by message only. [tested]
- The pool recovers: the failed waiter is removed from the queue; a later transaction works; `waitingCount` 0, `totalCount === idleCount`. [tested]
- The same message is used when waiting for a new connection to open (pg-pool line 251). [source]
- `pgPool.end()` with 2 callers waiting (pool of 1, one holder): `end()` resolves after the holder releases (about 1 s). New `connect()` calls after `end()` reject at once with `Cannot use a pool after calling end on the pool`. The two **existing waiters are never settled**: still pending 6 s later, `waitingCount` stays 2. With `connectionTimeoutMillis: 5000` they reject at 5.06 s with the timeout error. With nothing else alive, Node exits with "unsettled top-level await". [tested]
  The pool's `ending` branch only closes idle and returned clients and never touches `_pendingQueue` (pg-pool lines 133-145). [source]

Recommendation (checked against your constraints): [inferred]

- `connectionTimeoutMillis: 3000`. A holder always releases within 5 s because of `transaction_timeout`, so no wait longer than 5000 can help. Setting it makes an HTTP request fail with a clear error instead of hanging, and it is the only thing that settles callers stuck in the queue when `end()` runs.
- Because the timeout is shorter than the 20 s intake window, every waiter has failed or been served before `end()` is called. Intake stops first, so no new callers arrive.
- `max` explicit, not the default 10, sized under the database's `max_connections` divided by the number of app instances.
- Leave `idleTimeoutMillis` at 10000. `keepAlive: true` so idle sockets survive NAT and load balancer timeouts [inferred; not tested].
- Add `statement_timeout` in the connection config only if reads on the pool need a cap; transactions already have `transaction_timeout`.

### Q9. Drizzle schema per domain

[Drizzle config docs](https://orm.drizzle.team/docs/drizzle-config-file): `schema` is a "glob based path to drizzle schema file(s) or folder(s)", string or string array, e.g. `"./src/**/schema.ts"`. [source]

Run: `schema: "./src/domains/*/spi/*-table.ts"` with `foo` and `bar` domains ([kit-check/](database-ports/kit-check/)). `drizzle-kit generate` found `foo-table.ts` and `bar-table.ts`, ignored `bar-repository.ts`, and followed `import ... from "../../foo/spi/foo-table.ts"` with the `.ts` extension, producing the foreign key. It works with `NODE_OPTIONS=--no-experimental-strip-types`, so drizzle-kit uses its own loader and does not depend on Node type stripping. Importing `drizzle.config.ts` directly with Node 26 also works. [tested]

## Not verified

- Postgres versions other than 18.6, and any pool behavior against a real network drop (the earlier research covered a killed backend).
- `keepAlive: true` effect on real NAT timeouts.
- `pg` `connectionTimeoutMillis` while opening a new connection (as opposed to waiting in the queue). Read in source only.
- Drizzle 1.0 rc.5 for everything beyond the checks in `results/drizzle-0.45.4/rc5-partial-node-26.10.0.txt`, plus OTel and bench. I did not run the pool tests or drizzle-kit on it; its API can still change before stable.
- Zod parse of rows. Not added.
- `db.transaction()` misuse inside a client-bound repository is not blocked or tested.
- Docs pages were read through a summarizing fetch; the exact numbers come from the installed source.

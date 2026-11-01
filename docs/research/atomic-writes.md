# Patterns for atomic writes in a use case

Research for [#26](https://github.com/n8io/baseline/issues/26), which feeds [#25](https://github.com/n8io/baseline/issues/25). Researched 2026-11-01.

Evidence is tagged:

- **[source]** read in the owner's docs, book, spec or source code.
- **[tested]** I ran it. Code is in [`docs/research/atomic-writes/`](atomic-writes/); output is in [`atomic-writes/results/`](atomic-writes/results/).
- **[inferred]** reasoned from the above, not run.

## Short answer

Use **option 1, the transaction port with a callback**, with three changes to the shape in the ticket:

1. **Writes exist only inside the transaction.** `ports.ts` declares `FooReadRepository` (reads only) for use outside, and `FooRepository` (reads and writes) that only `fooTransaction` hands out. A forgotten transaction then fails type-checking. [tested]
2. **One repository per aggregate root.** A foo and its tags are one aggregate, so `fooRepository.insert(foo)` writes both rows. There is no `FooTagRepository`. This is what Evans prescribes, and it keeps most transactions to one repository call. [source]
3. **The adapter does more than BEGIN/COMMIT.** One shared SPI helper, `pgTransaction(pgPool, work)`, commits on `ok`, rolls back on `err` or a throw, listens for the client's `error` event, destroys a broken connection instead of returning it to the pool, closes the bound repositories when the transaction ends, and sets `transaction_timeout`. Each of these was needed in testing. [tested]

```ts
// src/domains/foo/ports.ts
export type FooReadRepository = {
  findById(id: string): Promise<Foo | undefined>;
  findByName(name: string): Promise<Foo | undefined>;
};
export type FooRepository = FooReadRepository & { insert(foo: Foo): Promise<Foo> };
export type FooTransactionPorts = { fooRepository: FooRepository }; // no fooTransaction: no nesting
export type FooTransaction = <T, E>(
  work: (ports: FooTransactionPorts) => Promise<Result<T, E>>,
) => Promise<Result<T, E>>; // commits on ok; rolls back on err or a throw
export type FooPorts = { fooReadRepository: FooReadRepository; fooTransaction: FooTransaction };

// src/domains/foo/use-cases/foo-create.ts
export const fooCreate =
  ({ fooTransaction }: Pick<FooPorts, "fooTransaction">) =>
  (input: FooCreateInput): Promise<Result<Foo, FooNameTakenError>> =>
    fooTransaction(async ({ fooRepository }) => {
      if (await fooRepository.findByName(input.name)) return err(new FooNameTakenError(input.name));
      return ok(await fooRepository.insert({ id: crypto.randomUUID(), ...input }));
    });
```

Full working code: [`ports.ts`](atomic-writes/foo/ports.ts), [`foo-create.ts`](atomic-writes/foo/use-cases/foo-create.ts), [`pg-transaction.ts`](atomic-writes/shared/pg-transaction.ts), [`foo-repository.postgres.ts`](atomic-writes/foo/spi/foo-repository.postgres.ts), [`foo-repository.memory.ts`](atomic-writes/foo/spi/foo-repository.memory.ts), and one [contract test](atomic-writes/tests/foo-transaction.contract.ts) that runs against both adapters.

Do not carry the transaction in `AsyncLocalStorage` (option 3). In testing, a write that outlived its transaction silently landed in the next request's transaction and was rolled back with it, and a forgotten transaction silently autocommitted. Option 1's closed-scope guard turned the same mistake into a thrown error. [tested]

## Strongest case against

Evans and Vernon say one transaction should change one aggregate. Evans: "Use the same aggregate boundaries to govern transactions" ([DDD Reference, p. 16](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf)). Vernon: "a properly designed bounded context modifies only one aggregate instance per transaction in all cases" ([Effective Aggregate Design, Part I, p. 4](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_1.pdf)). [source]

If the template follows that rule, every write is one repository call, and the adapter can make that call atomic on its own (option 5). I tested that: a failing tag insert left no foo row. [tested] Then the transaction port is extra weight on almost every use case: a callback, a second port, a second adapter per technology, and a contract test. It also makes it easy to put several aggregates, and slow outside calls, inside one transaction, which is what Vernon warns against. No type check stops a slow call inside the callback.

Why option 1 still wins: option 5 has no answer when a use case must change two aggregates atomically, and Vernon himself allows that when needed ([Part II, p. 4](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf)). "One write call per use case" can't be checked by the build, so an agent who writes two calls loses atomicity with no error. The goals ticket ([#20](https://github.com/n8io/baseline/issues/20)) bans ambiguity and asks for one pattern. Option 1 covers every case with one shape, and with aggregate repositories its common case is one call inside the callback.

## How it was tested

- **Postgres 18.6** in Docker (`postgres:18-alpine`).
- **Node 24.19.0, 26.10.0 and 22.22.1**, running `.ts` files directly (type stripping). All 31 checks pass on all three; the results are identical.
- `pg` 8.23.1, `pg-pool` 3.14.0, `drizzle-orm` 0.45.4, `@opentelemetry/sdk-trace` 3.0.0, `context-async-hooks` 3.0.0, `instrumentation` 0.300.0, `instrumentation-pg` 0.77.0, TypeScript 7.0.2.
- Results: [Node 24](atomic-writes/results/node-24.19.0.txt), [Node 26](atomic-writes/results/node-26.10.0.txt), [Node 22](atomic-writes/results/node-22.22.1.txt).
- To rerun: start Postgres, then in `docs/research/atomic-writes/` run `pnpm install`, `DATABASE_URL=postgres://… node run-all.ts` and `pnpm typecheck`.

The tests use a tiny assert harness, not Vitest, to keep the research folder small. The template itself would use Vitest.

## What the tests showed

### Option 1 works with a Result [tested]

| Check | Result |
|---|---|
| `ok` commits the foo and its tags | pass, Postgres and memory |
| `err` after a write rolls back and returns the same `err` | pass, Postgres and memory |
| A throw after a write rolls back and rethrows the same error object | pass, Postgres and memory |
| An SQL error mid-transaction (tag check constraint) rolls back the earlier foo insert; the pool still works | pass |
| 300 concurrent transactions (one third `ok`, `err`, throw) on a pool of 2 | exactly 100 rows; `totalCount` ≤ 2, `idleCount` = `totalCount`, `waitingCount` 0; no session `idle in transaction` |
| A connection killed mid-transaction (`pg_terminate_backend`) | error thrown, no row, broken client destroyed, next transaction works |
| A repository kept and used after its transaction ended | throws "used after its transaction ended", Postgres and memory |
| `fooCreate` returns `FooNameTakenError` for a taken name | pass, Postgres and memory |

### The adapter details that matter [tested]

- **A checked-out client needs an `error` listener.** When the server ended a connection mid-transaction, `pg` emitted `error` on the client. With no listener, Node crashed the whole process. Node's rule: an `error` event with no listener is thrown and the process exits ([events docs](https://nodejs.org/api/events.html#error-events)) [source]. `pg` advises attaching a listener but does not say a checked-out client needs one ([client docs](https://node-postgres.com/apis/client)) [source]. The helper attaches one for the life of the transaction.
- **Release a broken client with `release(true)`.** "If you pass a truthy value in the `destroy` parameter … the pool will be instructed to disconnect and destroy this client" ([pool docs](https://node-postgres.com/apis/pool)) [source]. The helper does this when `ROLLBACK` fails or the `error` event fired.
- **Use one client for the whole transaction.** "You must use the same client instance for all statements within a transaction" and "Do not use transactions with the pool.query method" ([transactions docs](https://node-postgres.com/features/transactions)) [source].
- **A slow call inside a transaction can be cut off by Postgres.** `SET LOCAL idle_in_transaction_session_timeout = '200ms'` then a 600 ms wait: the server ended the session ("terminating connection due to idle-in-transaction timeout") and nothing was committed. `SET LOCAL transaction_timeout = '300ms'` did the same ("terminating connection due to transaction timeout"). `transaction_timeout` was added in PostgreSQL 17 ([release notes](https://www.postgresql.org/docs/release/17.0/), [settings docs](https://www.postgresql.org/docs/current/runtime-config-client.html)) [source, tested]. This is the only guard against slow outside calls that I found; the build cannot catch them.

### Mistakes the build can and cannot catch [tested]

[`compile-checks/foo-transaction.compile.ts`](atomic-writes/compile-checks/foo-transaction.compile.ts) proves each error with `@ts-expect-error`. `tsc` fails if any of those lines stops being an error.

| Mistake | Caught by |
|---|---|
| Forgotten transaction (a write outside `fooTransaction`) | **Type error**: `FooReadRepository` has no `insert` |
| Nested transaction | **Type error**: the work's ports have no `fooTransaction` |
| Work that returns a plain value instead of a `Result` | **Type error** |
| A use case that picks only `fooTransaction` reaching for another repository | **Type error**, but an agent can widen the `Pick` |
| A read through `fooReadRepository` inside the work (runs outside the transaction) | Not caught. Harmless for writes; may read stale data |
| A slow outside call (HTTP, publish) inside the work | Not caught. `transaction_timeout` ends it at run time |
| A write not awaited, run after the transaction ended | Caught **at run time** by the closed-scope guard |

Two hazards I reproduced to show why the shape matters:

- A pool-bound write inside the callback is not rolled back by an `err`. Option 1 prevents this by giving no write method outside the transaction.
- A nested transaction on a pool of 1 waits forever. `pg`'s `connectionTimeoutMillis` defaults to 0, "which means no timeout" ([pool docs](https://node-postgres.com/apis/pool)) [source]. With a 500 ms timeout it failed with "timeout exceeded when trying to connect". Option 1 prevents this by giving the work no `fooTransaction`.

### A transaction does not make check-then-insert safe [tested]

Two concurrent `fooCreate` calls for the same name, both reading before either inserts, both returned `ok` and wrote two foos with one name. Postgres's default, Read Committed, lets each `SELECT` see "only data committed before the query began" ([isolation docs](https://www.postgresql.org/docs/current/transaction-iso.html)) [source]. With a unique index, the loser threw `23505`, which today would reach the error middleware as a 500. Uniqueness rules need a unique constraint whatever pattern is chosen. Whether the repository maps `23505` to the domain error is a question for #25.

The memory adapter runs transactions one at a time, so it never shows this race. That is stricter than Postgres, never weaker, but it means unit tests cannot prove a uniqueness rule under concurrency. Integration tests must.

### AsyncLocalStorage around `pg` [tested]

- **Promise forms keep the store.** 25 callers, each in its own `run()`, queued on a pool of 1: the store was right after `await pool.connect()`, `await client.query()` and `await pool.query()`. Same on Node 22, 24 and 26.
- **Callback forms lose it.** `pool.connect(cb)`, `pool.query(text, cb)` and `client.query(text, cb)` ran 19 of 20 callbacks in another caller's store, and 20 of 20 on a warm pool ([probe output](atomic-writes/results/als-callback-probe-node-24.19.0.txt)). The callbacks most likely run in the context of whoever opened the connection [inferred]. Node's docs describe this case: "If your code is callback-based, it is enough to promisify it" ([async_context docs](https://nodejs.org/api/async_context.html)) [source]. Node 24 made `AsyncLocalStorage` use `AsyncContextFrame` by default ([v24.0.0 release](https://nodejs.org/en/blog/release/v24.0.0)) [source]; it changed nothing here.
- **OpenTelemetry is fine with option 1.** 10 concurrent requests, each its own active span, `fooCreate` on a pool of 1: every `pg` span (`pg-pool.connect`, `BEGIN`, `SELECT`, two `INSERT`s, `COMMIT`) sat under its own request's span. No span landed in another trace. `instrumentation-pg` documents the `pg-pool.connect` span as "Pool connection acquisition wait time" ([README](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pg)) [source].

### Drizzle's transaction ignores a Result [tested]

- Returning an `err` from `db.transaction()` **commits** the writes. Drizzle rolls back only on a throw; `tx.rollback()` "throws an exception that rollbacks the transaction" ([Drizzle transactions](https://orm.drizzle.team/docs/transactions)) [source, tested].
- A ten-line wrapper fixes it: call `tx.rollback()` on `err`, catch `TransactionRollbackError`, return the `err`. Tested.
- `tx.transaction()` nests with a savepoint; an inner rollback kept the outer write. Tested.

If the adapter uses Drizzle for queries, `pgTransaction` should still own BEGIN/COMMIT on the `pg` client and hand Drizzle the client, or wrap `db.transaction` as above. Either is SPI-only code.

## The options

Judged against [#20](https://github.com/n8io/baseline/issues/20): Obvious > Enforced > Swappable > Short, agents write the code, few dependencies.

| | Obvious | Enforced | Swappable | Short | `err` rolls back | New deps |
|---|---|---|---|---|---|---|
| 1. Transaction port, callback | Yes: the use case shows the atomic block | Forgotten and nested caught by types | Same port, memory adapter tested | Medium | Yes, by the port's contract | None |
| 2. Unit of Work object | Commit point visible | Forgotten `commit` or `await using` not caught | Needs change tracking per adapter | Long | Only with care | An ORM, or a lot of code |
| 3. `AsyncLocalStorage` | Hidden: nothing in the use case | Forgotten transaction silent | Memory adapter must fake the store | Short | Only if the wrapper checks `ok` | None (or a library) |
| 4. Wrap outside the use case | Hidden from the use case | Uniform, but every call is a transaction | Needs 3 or per-request ports | Short in the use case | Only if the wrapper checks `ok` | None |
| 5. One aggregate save | Yes | "One write per use case" not checkable | Yes | Shortest | Not needed: no write before the decision | None |

### 1. Transaction port with a callback

Recommended. See the short answer.

- **What sources do.** Kysely, Drizzle and Prisma all pass a transaction object into a callback, commit on return and roll back on a throw. Kysely: on a throw "the transaction is rolled back" ([docs](https://kysely.dev/docs/examples/transactions/simple-transaction)). Prisma ORM 8: "The transaction commits when the callback returns and rolls back when it throws", and "A helper that runs inside the caller's transaction takes `tx` as a parameter" ([docs](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)). None of them carries the transaction implicitly. [source]
- **Cosmic Python's Unit of Work** (the ports-and-adapters book for Python) is close to this shape: the UoW exposes repositories (`uow.batches`) and rolls back on exit unless committed; "we prefer to roll back by default because it's easier to understand" ([chapter 6](https://www.cosmicpython.com/book/chapter_06_uow.html)) [source]. Option 1 goes one step further: the `Result` decides commit or rollback, so there is no `commit()` to forget or to call too early.

### 2. Unit of Work object (Fowler, .NET)

```ts
const fooUnitOfWork = fooUnitOfWorkStart();
const foo = { id: crypto.randomUUID(), ...input };
fooUnitOfWork.fooRepository.add(foo);    // recorded, not written
await fooUnitOfWork.commit();           // all writes in one transaction
```

Fowler's Unit of Work "Maintains a list of objects affected by a business transaction and coordinates the writing out of changes" ([catalog](https://martinfowler.com/eaaCatalog/unitOfWork.html)) [source]. Real implementations rely on an ORM that tracks changes: EF Core's `DbContext` in Microsoft's [eShop](https://github.com/dotnet/eShop/blob/main/src/Ordering.Domain/SeedWork/IUnitOfWork.cs), Hibernate in Java. `pg`, Drizzle and Kysely have no change tracking, so the template would have to write one, or add an ORM such as MikroORM. Both fail few-dependencies or Short. Reads that must see earlier unflushed writes need an identity map too. [inferred]

A lighter variant, explicit commit with `await using` for rollback and release on scope exit, runs on Node 24 and 26 but not Node 22 [tested: [probe](atomic-writes/tests/await-using.probe.ts)]. It loses to option 1 on Enforced: writing `const` instead of `await using` leaks a connection, and calling `commit()` before returning an `err` commits; neither is a type error. [inferred]

### 3. Implicit context through `AsyncLocalStorage`

```ts
export const fooCreate = ({ fooRepository }: FooPorts) => (input: FooCreateInput) =>
  fooTransaction(async () => { // or a @Transactional decorator
    await fooRepository.insert({ id: crypto.randomUUID(), ...input }); // finds the transaction itself
    return ok(…);
  });
```

- **Who does it.** `typeorm-transactional` "uses ALS or cls-hooked to … propagate transactions" ([README](https://github.com/Aliheym/typeorm-transactional)); its last push was 2023-12. `nestjs-cls`'s Transactional plugin stores "the transaction reference in the CLS context" and offers seven propagation modes ([docs](https://papooch.github.io/nestjs-cls/plugins/available-plugins/transactional)). Sairyss's [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon/blob/master/src/libs/db/sql-repository.base.ts) (15k stars) keeps the transaction connection in `nestjs-request-context` and its repositories pick it up. Spring's `@Transactional` is the model for all of them. [source]
- **`err` does not roll back by default.** Spring "marks a transaction for rollback only in the case of runtime, unchecked exceptions" ([docs](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html)). Every decorator above commits when the method returns. A returned `err` would commit. [source]
- **Tested hazards.** A forgotten wrapper silently autocommits. A write left running after the transaction ended went into the next request's transaction on the same pooled connection, and vanished when that request rolled back, with no error anywhere. [tested]
- It fails Obvious (the use case does not show which writes are atomic) and Enforced (both hazards are silent).

### 4. Wrapping outside the use case

```ts
// src/server.ts (composition root)
const fooCreateAtomic = (input: FooCreateInput) =>
  pgTransaction(pgPool, (client) => fooCreate(fooPortsPostgres(client))(input));
```

Microsoft's eShop does this: a MediatR `TransactionBehavior` wraps every command handler in a transaction and commits after it returns ([source](https://github.com/dotnet/eShop/blob/main/src/Ordering.API/Application/Behaviors/TransactionBehavior.cs)) [source]. It keeps the use case free of transactions. But:

- The use case no longer shows what is atomic (fails Obvious).
- The transaction spans the whole use case, so slow outside calls are always inside it.
- The repositories still need the transaction: either per-request ports, built in the composition root as above, or option 3.
- The wrapper must check `result.ok`, or an `err` commits. [inferred]

### 5. One aggregate save

```ts
export const fooCreate = ({ fooRepository }: FooPorts) => async (input: FooCreateInput) => {
  if (await fooRepository.findByName(input.name)) return err(new FooNameTakenError(input.name));
  return ok(await fooRepository.insert({ id: crypto.randomUUID(), ...input })); // atomic inside the adapter
};
```

This is the DDD default. Evans: "Provide repositories only for aggregate roots that actually need direct access" ([DDD Reference, p. 17](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf)). Vernon: when one change must update other aggregates, "use eventual consistency" ([Part II, p. 3](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf)). Tested: a failing tag insert left no foo. It is the strongest alternative; see the case against above. The recommendation keeps its core idea (aggregate repositories) and adds the port for the cases it cannot cover.

## Feeds for #25

- **Names.** `FooReadRepository` for the read-only port is a placeholder. Whether reads instead go through `fooTransaction` too (one way, but a BEGIN/COMMIT round trip per read) is a choice for #25.
- **Where `pgTransaction` lives.** It is shared SPI code with no domain knowledge. It fits the shared database package ([#12](https://github.com/n8io/baseline/issues/12)).
- **Timeout value.** `pgTransaction` should `SET LOCAL transaction_timeout` (PostgreSQL 17+). The value is open.
- **Unique violations.** The race loser throws `23505`. Decide whether the repository turns it into the domain error or it stays a 500.
- **Contract test.** One test file runs against both adapters, as in [`foo-transaction.contract.ts`](atomic-writes/tests/foo-transaction.contract.ts).
- **An architecture or lint check** could flag a call on a port that did not come from the work's parameter inside a `fooTransaction` callback. It would need an AST, not `es-module-lexer`. Not built.

## Not verified

- **Drizzle as the query layer inside `pgTransaction`** (handing it the checked-out `pg` client). I tested Drizzle's own `db.transaction` only.
- **`BEGIN` and `SET LOCAL transaction_timeout` sent in one round trip.** Tested as two queries.
- **The AST check** for slow calls inside the callback.
- **Load.** No measurement of the cost of the extra port, or of throughput under pool pressure beyond 300 transactions on a pool of 2.
- **MikroORM** (a Unit of Work ORM for TypeScript) was not tried, because option 2 already fails few-dependencies.
- **Vitest.** The tests use a small assert harness, not the template's runner.
- **Evans's book and Vernon's IDDD book** were not read directly; I used Evans's DDD Reference and Vernon's three-part essay, both by the authors.

## Sources

- node-postgres: [transactions](https://node-postgres.com/features/transactions), [pooling](https://node-postgres.com/features/pooling), [Pool API](https://node-postgres.com/apis/pool), [Client API](https://node-postgres.com/apis/client)
- PostgreSQL 18: [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [client settings](https://www.postgresql.org/docs/current/runtime-config-client.html), [17.0 release notes](https://www.postgresql.org/docs/release/17.0/)
- Node.js: [async_context](https://nodejs.org/api/async_context.html), [events, error events](https://nodejs.org/api/events.html#error-events), [v24.0.0 release](https://nodejs.org/en/blog/release/v24.0.0)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [Kysely transactions](https://kysely.dev/docs/examples/transactions/simple-transaction), [Kysely controlled transactions](https://kysely.dev/docs/examples/transactions/controlled-transaction), [Prisma ORM 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [instrumentation-pg README](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pg)
- Fowler, [Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- Evans, [DDD Reference (2015)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf), pp. 16–17
- Vernon, Effective Aggregate Design [Part I](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_1.pdf) and [Part II](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf)
- Percival and Gregory, [Cosmic Python, chapter 6](https://www.cosmicpython.com/book/chapter_06_uow.html)
- [Spring rollback rules](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html), [nestjs-cls Transactional](https://papooch.github.io/nestjs-cls/plugins/available-plugins/transactional), [typeorm-transactional](https://github.com/Aliheym/typeorm-transactional)
- [Sairyss/domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [dotnet/eShop](https://github.com/dotnet/eShop)

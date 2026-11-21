# Schedules

Read when adding, changing, testing or removing a Schedule. A Schedule calls one Use case on a cron, in the Worker. The examples use a `baz` context whose Aggregate Baz has a Schedule that archives stale bazs; an Aggregate made by `pnpm aggregate-create` starts with the same files under its own name.

## The file pair

One file per Schedule in the context's `adapters/inbound/`. It exports two things: `<aggregate>Schedule`, the name and cron that migrate syncs, and `<aggregate>ScheduleCreate`, which the Worker starts with the context's Use cases.

```ts
// src/contexts/baz/adapters/inbound/baz-schedule.ts
const bazScheduleActor: Actor = {
	id: "baz-schedule",
	kind: "client",
	scopes: [],
};

// Daily at 03:00 UTC. Override per environment: SCHEDULE_BAZ_STALE_ARCHIVE="*/5 * * * *" or "off".
// When it runs: src/migrate.ts syncs this to the database, once per deploy.
export const bazSchedule = { cron: "0 3 * * *", name: "baz.stale-archive" };

// What it runs: src/worker.ts starts this with the context's Use cases.
export const bazScheduleCreate = (u: BazUseCases) =>
	queueScheduleCreate({
		...bazSchedule,
		run: () => u.bazStaleArchive(bazScheduleActor),
	});
```

- The Actor is a `client` with id `<aggregate>-schedule` and only the scopes its Use case checks.
- The name is `<aggregate>.<use case words, kebab>`. The cron is UTC with minute precision, so the shortest interval is one minute.
- Two Schedules for one Aggregate: one file each, `adapters/inbound/<aggregate>-<words>-schedule.ts` exporting `<aggregate><Words>Schedule` and `<aggregate><Words>ScheduleCreate` (`invoiceOverdueMarkSchedule`, `invoiceOverdueMarkScheduleCreate`). They may share one Actor in `adapters/inbound/<aggregate>-schedule-actor.ts`.

## Wiring

`pnpm aggregate-create` wires a new Aggregate's first Schedule. For another one, add the same four things by hand:

1. Import the pair in the context's `index.ts`.
2. Add `bazSchedule,` to its `<context>Schedules` list, above `// wiring: schedule-definitions`: `src/migrate.ts` syncs that list.
3. Add `bazScheduleCreate(useCases),` to the `schedules` list `<context>ContextCreate` returns, above `// wiring: schedules`: the Worker starts every context's list.
4. Declare its override in `.env.schema`, above `# wiring: schedules`, with the decorator line, or boot fails while it is unset:

```text
# @sensitive=false @required=false
SCHEDULE_BAZ_STALE_ARCHIVE=
```

- The queue makes the variable's name from the Schedule's: `SCHEDULE_`, then the name in upper case, with `.` and `-` turned into `_` (`baz.stale-archive` is `SCHEDULE_BAZ_STALE_ARCHIVE`). Its value is a cron or `off`. A cron override acts in migrate; the Worker reads only `off`.
- migrate adds, updates and removes Schedules once per rollout. The Worker only starts the ones migrate has added: it logs "Schedule is not in the database" for any other, and runs it after a restart that follows a migrate.
- Removing a Schedule: delete its file, its export, its two list entries and its `.env.schema` lines. The next migrate removes it from the database.

## The Use case

A Schedule's Use case is an ordinary Use case. It may publish Events inside its transaction and send live updates after commit, like any other. Each tick starts its own trace, and the Events it publishes carry that trace on.

It handles everything due as of now, not a fixed batch: one run must catch up on any number of missed ticks, and a repeat must change nothing. pg-boss enqueues one run for all the ticks missed during an outage, skips a tick while a run is still active, and retries a failed run, so a run can come late, once for several ticks, or twice.

```ts
// src/contexts/baz/application/baz-stale-archive.ts
export const bazStaleArchive =
	({
		bazClock,
		bazTransaction,
	}: Pick<BazPorts, "bazClock" | "bazTransaction">) =>
	(_actor: Actor): Promise<Result<number, never>> =>
		bazTransaction(async ({ bazRepository }) => {
			const now = bazClock.now();
			return ok(await bazRepository.archiveStale(bazStaleBefore(now), now));
		});
```

## "Due" work is a repository method

The test for "due" is not a specification. It is one repository method whose Postgres side is a single `UPDATE ... WHERE ... RETURNING`, so two runs never claim the same row, and whose `WHERE` skips rows already done, so a repeat changes nothing. This set-based write is the one change to an Aggregate that skips its transitions: loading every due row to change it one at a time would lose that single claim. `domain/<aggregate>.ts` still computes the method's inputs (`bazStaleBefore(now)` gives the cut-off). Adapters may not import the domain's functions (A4), so the memory adapter repeats the predicate, and the repository contract test holds the two equal.

```ts
// src/contexts/baz/adapters/outbound/baz-repository.postgres.ts
archiveStale: async (before, now) => {
	const archived = await db
		.update(baz)
		.set({ archivedAt: now })
		.where(and(isNull(baz.archivedAt), lt(baz.updatedAt, before)))
		.returning({ id: baz.id });
	return archived.length;
},
```

```ts
// src/contexts/baz/adapters/outbound/baz-repository.memory.ts
archiveStale: async (before, now) => {
	let archived = 0;
	for (const baz of state.bazs.values()) {
		if (baz.archivedAt === null && baz.updatedAt < before) {
			state.bazs.set(baz.id, { ...baz, archivedAt: new Date(now) });
			archived += 1;
		}
	}
	return archived;
},
```

When each changed row needs an Event, return the rows (`.returning()`) instead of a count and publish one Event per row in the same transaction, keyed by its id.

## Tests

- The repository method: one case in `<aggregate>-repository.contract.ts`, so the memory and Postgres adapters agree on the boundary.
- The Use case: build the context through its interface on memory connections with a memory clock ([tests.md](tests.md)), create rows at times due and not due, move the clock, run it, and read which rows changed.
- The Schedule: take it from the context's `schedules`, call `run()`, and check the result and a later read. That is also how to run a Schedule on demand in any test: never wait for the cron.

```ts
// src/contexts/baz/adapters/inbound/baz-schedule.test.ts
const clock = clockMemoryCreate(new Date("2020-01-01T00:00:00Z"));
const connected = { ...connections, clock };
const { schedules, useCases } = contextsCreate(connected).bazContext;
const created = await useCases.bazCreate(owner, { name: "old" });
if (!created.ok) throw created.error;
const bazId = created.value.id;
clock.set(new Date("2026-06-01T00:00:00Z"));
const schedule = schedules.find((s) => s.name === "baz.stale-archive");
expect(schedule).toMatchObject(bazSchedule);

expect(await schedule?.run()).toEqual(ok(1));
const archived = await useCases.bazGet(owner, { bazId });
expect(archived.ok && archived.value.archivedAt).toBeInstanceOf(Date);
expect(await schedule?.run()).toEqual(ok(0));
```

The Worker refuses `DATABASE_URL=memory://`, so no Schedule or Event handler runs in memory mode. To watch one run, set `SCHEDULE_<NAME>="* * * * *"` and restart `pnpm dev`: it runs migrate on Postgres before it starts the Worker.

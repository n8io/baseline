# Schedules

Read when adding, changing, testing or removing a Schedule. A Schedule calls one Use case on a cron, in the Worker. The examples use a `baz` Domain whose Schedule archives stale bazs; an Aggregate made by `pnpm aggregate-create` starts with the same files under its own name.

## The file pair

One file per Schedule in the Domain's `adapters/inbound/`. It exports two things: `<domain>Schedule`, the name and cron that migrate syncs, and `<domain>ScheduleCreate`, which the Worker starts with the Domain's Use cases.

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

// What it runs: src/worker.ts starts this with the Domain's Use cases.
export const bazScheduleCreate = (u: BazUseCases) =>
	queueScheduleCreate({
		...bazSchedule,
		run: () => u.bazStaleArchive(bazScheduleActor),
	});
```

- The Actor is a `client` with id `<domain>-schedule` and only the scopes its Use case checks.
- The name is `<domain>.<use case words, kebab>`. The cron is UTC with minute precision, so the shortest interval is one minute.
- Two Schedules in one Domain: one file each, `adapters/inbound/<domain>-<words>-schedule.ts` exporting `<domain><Words>Schedule` and `<domain><Words>ScheduleCreate` (`tournamentStartSchedule`, `tournamentStartScheduleCreate`). They may share one Actor in `adapters/inbound/<domain>-schedule-actor.ts`.

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

- `queueScheduleEnvName` makes the variable's name: upper case, with `.` and `-` turned into `_` (`baz.stale-archive` is `SCHEDULE_BAZ_STALE_ARCHIVE`). Its value is a cron or `off`. A cron override acts in migrate; the Worker reads only `off`.
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
			baz.archivedAt = new Date(now);
			archived += 1;
		}
	}
	return archived;
},
```

When each changed row needs an Event, return the rows (`.returning()`) instead of a count and publish one Event per row in the same transaction, keyed by its id.

## Tests

- The repository method: one case in `<domain>-repository.contract.ts`, so the memory and Postgres adapters agree on the boundary.
- The Use case: build the Domain's memory ports, put rows due and not due in place, run it, and check which rows changed.
- The Schedule: build the Domain's Use cases on memory ports, call `run()`, and check the result and the rows. That is also how to run a Schedule on demand in any test: never wait for the cron.

```ts
// src/contexts/baz/adapters/inbound/baz-schedule.test.ts
const schedule = bazScheduleCreate(bazUseCasesCreate(ports));

expect(schedule).toMatchObject(bazSchedule);
expect(await schedule.run()).toEqual(ok(1));
expect(state.bazs.get(id)?.archivedAt).toBeInstanceOf(Date);
expect(await schedule.run()).toEqual(ok(0));
```

The Worker refuses `DATABASE_URL=memory://`, so no Schedule or Consumer runs in memory mode. To watch one run, set `SCHEDULE_<NAME>="* * * * *"` and restart `pnpm dev`: it runs migrate on Postgres before it starts the Worker.

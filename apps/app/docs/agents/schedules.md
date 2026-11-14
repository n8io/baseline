# Schedules

Read when adding, changing, testing or removing a Schedule. A Schedule calls one Use case on a cron, in the Worker. The examples use a `bar` Domain whose Schedule archives stale bars; a Domain made by `pnpm domain-create` starts with the same files under its own name.

## The file pair

One file per Schedule in the Domain's `api/`. It exports two things: `<domain>Schedule`, the name and cron that migrate syncs, and `<domain>ScheduleCreate`, which the Worker starts with the Domain's Use cases.

```ts
// src/domains/bar/api/bar-schedule.ts
const barScheduleActor: Actor = {
	id: "bar-schedule",
	kind: "client",
	scopes: [],
};

// Daily at 03:00 UTC. Override per environment: SCHEDULE_BAR_STALE_ARCHIVE="*/5 * * * *" or "off".
// When it runs: src/migrate.ts syncs this to the database, once per deploy.
export const barSchedule = { cron: "0 3 * * *", name: "bar.stale-archive" };

// What it runs: src/worker.ts starts this with the Domain's Use cases.
export const barScheduleCreate = (u: BarUseCases) =>
	queueScheduleCreate({
		...barSchedule,
		run: () => u.barStaleArchive(barScheduleActor),
	});
```

- The Actor is a `client` with id `<domain>-schedule` and only the scopes its Use case checks.
- The name is `<domain>.<use case words, kebab>`. The cron is UTC with minute precision, so the shortest interval is one minute.
- Two Schedules in one Domain: one file each, `api/<domain>-<words>-schedule.ts` exporting `<domain><Words>Schedule` and `<domain><Words>ScheduleCreate` (`tournamentStartSchedule`, `tournamentStartScheduleCreate`). They may share one Actor in `api/<domain>-schedule-actor.ts`.

## Wiring

`pnpm domain-create` wires a new Domain's first Schedule. For another one, add the same four things by hand:

1. Export the pair from the Domain's `api/index.ts`, inside its `piece-start: queue` block.
2. Add `barSchedule,` to the `schedules` list that `src/migrate.ts` passes to `queueSchedulesSync`, above `// domain-create: schedules`.
3. Add `barScheduleCreate(useCases.barUseCases),` to the `schedules` list that `src/worker.ts` passes to `queueSchedulesStart`, above the same marker.
4. Declare its override in `.env.schema`, above `# domain-create: schedules`, with the decorator line, or boot fails while it is unset:

```text
# @sensitive=false @required=false
SCHEDULE_BAR_STALE_ARCHIVE=
```

- `queueScheduleEnvName` makes the variable's name: upper case, with `.` and `-` turned into `_` (`bar.stale-archive` is `SCHEDULE_BAR_STALE_ARCHIVE`). Its value is a cron or `off`. A cron override acts in migrate; the Worker reads only `off`.
- migrate adds, updates and removes Schedules once per rollout. The Worker only starts the ones migrate has added: it logs "Schedule is not in the database" for any other, and runs it after a restart that follows a migrate.
- Removing a Schedule: delete its file, its export, its two list entries and its `.env.schema` lines. The next migrate removes it from the database.

## The Use case

A Schedule's Use case is an ordinary Use case. It may publish Events inside its transaction and send live updates after commit, like any other. Each tick starts its own trace, and the Events it publishes carry that trace on.

It handles everything due as of now, not a fixed batch: one run must catch up on any number of missed ticks, and a repeat must change nothing. pg-boss enqueues one run for all the ticks missed during an outage, skips a tick while a run is still active, and retries a failed run, so a run can come late, once for several ticks, or twice.

```ts
// src/domains/bar/use-cases/bar-stale-archive.ts
export const barStaleArchive =
	({
		barClock,
		barTransaction,
	}: Pick<BarPorts, "barClock" | "barTransaction">) =>
	(_actor: Actor): Promise<Result<number, never>> =>
		barTransaction(async ({ barRepository }) => {
			const now = barClock.now();
			return ok(await barRepository.archiveStale(barStaleBefore(now), now));
		});
```

## "Due" work is a repository method

The test for "due" is not a Rule. It is one repository method whose Postgres side is a single `UPDATE ... WHERE ... RETURNING`, so two runs never claim the same row, and whose `WHERE` skips rows already done, so a repeat changes nothing. A Rule may compute the method's inputs (`barStaleBefore(now)` gives the cut-off). The adapters may not import Rules, so the memory adapter repeats the predicate, and the repository contract test holds the two equal.

```ts
// src/domains/bar/spi/bar-repository.postgres.ts
archiveStale: async (before, now) => {
	const archived = await db
		.update(bar)
		.set({ archivedAt: now })
		.where(and(isNull(bar.archivedAt), lt(bar.updatedAt, before)))
		.returning({ id: bar.id });
	return archived.length;
},
```

```ts
// src/domains/bar/spi/bar-repository.memory.ts
archiveStale: async (before, now) => {
	let archived = 0;
	for (const bar of state.bars.values()) {
		if (bar.archivedAt === null && bar.updatedAt < before) {
			bar.archivedAt = new Date(now);
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
// src/domains/bar/api/bar-schedule.test.ts
const schedule = barScheduleCreate(barUseCasesCreate(ports));

expect(schedule).toMatchObject(barSchedule);
expect(await schedule.run()).toEqual(ok(1));
expect(state.bars.get(id)?.archivedAt).toBeInstanceOf(Date);
expect(await schedule.run()).toEqual(ok(0));
```

The Worker refuses `DATABASE_URL=memory://`, so no Schedule or Consumer runs in memory mode. To watch one run, set `SCHEDULE_<NAME>="* * * * *"` and restart `pnpm dev`: it runs migrate on Postgres before it starts the Worker.

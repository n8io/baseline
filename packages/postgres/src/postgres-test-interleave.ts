import { setTimeout } from "node:timers/promises";

/** The pool the helper watches `pg_stat_activity` through: a `PostgresPool` fits. */
export type PostgresTestInterleavePool = {
	query(text: string): Promise<{ rows: unknown[] }>;
};

export type PostgresTestInterleaveOptions<A, B> = {
	/** Runs until it awaits `pause()`, typically right after it took a lock. */
	first: (pause: () => Promise<void>) => Promise<A>;
	pgPool: PostgresTestInterleavePool;
	/** Starts once `first` paused. */
	second: () => Promise<B>;
	/** How long `second` may run without waiting on a lock or finishing. Default 5 s. */
	timeoutMs?: number | null;
};

// The backends in this database that wait on a lock now, this poll's own excluded.
const lockWaitersRead = async (
	pgPool: PostgresTestInterleavePool,
): Promise<Set<unknown>> => {
	const { rows } = await pgPool.query(
		`SELECT pid FROM pg_stat_activity
		 WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
	);
	return new Set(
		rows.map((row) =>
			typeof row === "object" && row !== null && "pid" in row
				? row.pid
				: undefined,
		),
	);
};

// Forces the interleaving a race test needs: `first` runs to `pause()`, `second` starts, and
// `first` resumes only once `second` waits on a lock or has finished. `secondWaited` says which.
// A backend that waited on a lock before `second` started does not count; any other one in the
// same database does, so keep other work off the test's database while it runs.
export const postgresTestInterleave = async <A, B>({
	first,
	pgPool,
	second,
	timeoutMs: timeoutMsGiven,
}: PostgresTestInterleaveOptions<A, B>): Promise<{
	first: A;
	second: B;
	secondWaited: boolean;
}> => {
	const timeoutMs = timeoutMsGiven ?? 5_000;
	const { promise: paused, resolve: pausedResolve } =
		Promise.withResolvers<void>();
	const { promise: resumed, resolve: resume } = Promise.withResolvers<void>();
	let pauseCalled = false;
	let resumeCalled = false;
	const firstRun = Promise.try(() =>
		first(() => {
			if (pauseCalled) throw new Error("first called pause() twice");
			pauseCalled = true;
			pausedResolve();
			return resumed;
		}),
	).then((value) => {
		if (!resumeCalled) {
			throw new Error("first finished before it was resumed; await pause()");
		}
		return value;
	});
	const firstEarly = await Promise.race([
		paused.then(() => false),
		firstRun.then(
			() => true,
			() => true,
		),
	]);
	if (firstEarly && !pauseCalled) {
		await firstRun.catch((error: unknown) => {
			throw error instanceof Error &&
				error.message.startsWith("first finished before")
				? new Error("first finished without calling pause()")
				: error;
		});
	}

	let secondWaited = false;
	try {
		const waitingBefore = await lockWaitersRead(pgPool);
		let secondDone = false;
		const secondRun = Promise.try(second).finally(() => {
			secondDone = true;
		});
		// Keep a rejection from going unhandled while it is polled for.
		secondRun.catch(() => undefined);
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const waiting = await lockWaitersRead(pgPool);
			if ([...waiting].some((pid) => !waitingBefore.has(pid))) {
				secondWaited = true;
				break;
			}
			if (secondDone) break;
			if (Date.now() > deadline) {
				throw new Error(
					`second neither waited on a lock nor finished within ${timeoutMs} ms`,
				);
			}
			await setTimeout(10);
		}
		resumeCalled = true;
		resume();
		const [firstResult, secondResult] = await Promise.all([
			firstRun,
			secondRun,
		]);
		return { first: firstResult, second: secondResult, secondWaited };
	} finally {
		// On a failure `first` still resumes, so its transaction ends and its client goes back.
		resumeCalled = true;
		resume();
	}
};

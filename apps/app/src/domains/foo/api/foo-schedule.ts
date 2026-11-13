import type { Actor } from "@n8io/baseline-authn";
import { queueScheduleCreate } from "@n8io/baseline-queue";
import type { FooUseCases } from "../index.ts";

const fooScheduleActor: Actor = {
	id: "foo-schedule",
	kind: "client",
	scopes: [],
};

// Daily at 03:00 UTC. Override per environment: SCHEDULE_FOO_STALE_ARCHIVE="*/5 * * * *" or "off".
// When it runs: src/migrate.ts syncs this to the database, once per deploy.
export const fooSchedule = { cron: "0 3 * * *", name: "foo.stale-archive" };

// What it runs: src/worker.ts starts this with the Domain's Use cases.
export const fooScheduleCreate = (u: FooUseCases) =>
	queueScheduleCreate({
		...fooSchedule,
		run: () => u.fooStaleArchive(fooScheduleActor),
	});

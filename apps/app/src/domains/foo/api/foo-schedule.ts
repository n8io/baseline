import type { Actor } from "@n8io/baseline-authn";
import { queueScheduleCreate } from "@n8io/baseline-queue";
import type { FooUseCases } from "../index.ts";

const fooScheduleActor: Actor = {
	id: "foo-schedule",
	kind: "client",
	scopes: [],
};

// Daily at 03:00 UTC. Override per environment: SCHEDULE_FOO_STALE_ARCHIVE="*/5 * * * *" or "off".
export const fooScheduleCreate = (u: FooUseCases) =>
	queueScheduleCreate({
		name: "foo.stale-archive",
		cron: "0 3 * * *",
		run: () => u.fooStaleArchive(fooScheduleActor),
	});

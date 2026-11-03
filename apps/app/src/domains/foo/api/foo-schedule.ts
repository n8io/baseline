import type { Actor } from "@n8io/baseline-authn";
import { scheduleCreate } from "@n8io/baseline-queue";
import type { FooUseCases } from "../index.ts";

const fooScheduleActor: Actor = {
	id: "foo-schedule",
	kind: "client",
	scopes: [],
};

// Daily at 03:00 UTC. Override per environment: SCHEDULE_FOO_STALE_ARCHIVE="*/5 * * * *" or "off".
export const fooSchedule = (u: FooUseCases) =>
	scheduleCreate("foo.stale-archive", "0 3 * * *", () =>
		u.fooStaleArchive(fooScheduleActor),
	);

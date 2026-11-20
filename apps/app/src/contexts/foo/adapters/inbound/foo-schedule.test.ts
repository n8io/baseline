import type { Actor } from "@n8io/baseline-authn";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../../clock.ts";
import { connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../contexts.ts";
import { fooSchedules } from "../../index.ts";
import { fooSchedule } from "./foo-schedule.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

describe("foo's schedule", () => {
	it("runs daily at 03:00 UTC as foo.stale-archive", () => {
		expect(fooSchedules).toContainEqual({
			cron: "0 3 * * *",
			name: "foo.stale-archive",
		});
	});

	it("archives the stale foos when run, and nothing on a repeat", async () => {
		const clock = clockMemoryCreate(new Date("2020-01-01T00:00:00Z"));
		const connected = { ...connections, clock };
		const { schedules, useCases } = contextsCreate(connected).fooContext;
		const created = await useCases.fooCreate(owner, { name: "old" });
		if (!created.ok) throw created.error;
		const fooId = created.value.id;
		clock.set(new Date("2026-06-01T00:00:00Z"));
		const schedule = schedules.find((s) => s.name === "foo.stale-archive");
		expect(schedule).toMatchObject(fooSchedule);

		expect(await schedule?.run()).toEqual(ok(1));
		const archived = await useCases.fooGet(owner, { fooId });
		expect(archived.ok && archived.value.archivedAt).toBeInstanceOf(Date);
		expect(await schedule?.run()).toEqual(ok(0));
	});
});

import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooUseCasesCreate } from "../use-cases/foo-use-cases.ts";
import { fooSchedule, fooScheduleCreate } from "./foo-schedule.ts";

describe("fooScheduleCreate", () => {
	it("runs daily at 03:00 UTC as foo.stale-archive", () => {
		expect(fooSchedule).toEqual({
			cron: "0 3 * * *",
			name: "foo.stale-archive",
		});
	});

	it("archives the stale foos when run, and nothing on a repeat", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const longAgo = new Date("2020-01-01T00:00:00Z");
		const id = idCreate("foo");
		state.foos.set(id, {
			archivedAt: null,
			createdAt: longAgo,
			createdBy: "owner",
			id,
			name: "old",
			updatedAt: longAgo,
		});
		const schedule = fooScheduleCreate(fooUseCasesCreate(ports));

		expect(schedule).toMatchObject(fooSchedule);
		expect(await schedule.run()).toEqual(ok(1));
		expect(state.foos.get(id)?.archivedAt).toBeInstanceOf(Date);
		expect(await schedule.run()).toEqual(ok(0));
	});
});

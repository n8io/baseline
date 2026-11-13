import { ok } from "@n8io/baseline-result";
import { describe, expect, it, vi } from "vitest";
import type { FooUseCases } from "../index.ts";
import { fooSchedule, fooScheduleCreate } from "./foo-schedule.ts";

describe("fooScheduleCreate", () => {
	it("archives stale foos daily at 03:00 UTC as the foo-schedule actor", async () => {
		const fooStaleArchive = vi.fn(async () => ok(2));
		const schedule = fooScheduleCreate({
			fooStaleArchive,
		} as unknown as FooUseCases);

		expect(fooSchedule).toEqual({
			cron: "0 3 * * *",
			name: "foo.stale-archive",
		});
		expect(schedule).toMatchObject(fooSchedule);
		await expect(schedule.run()).resolves.toEqual(ok(2));
		expect(fooStaleArchive).toHaveBeenCalledWith({
			id: "foo-schedule",
			kind: "client",
			scopes: [],
		});
	});
});

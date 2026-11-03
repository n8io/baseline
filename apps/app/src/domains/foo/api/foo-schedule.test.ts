import { ok } from "@n8io/baseline-result";
import { describe, expect, it, vi } from "vitest";
import type { FooUseCases } from "../index.ts";
import { fooSchedule } from "./foo-schedule.ts";

describe("fooSchedule", () => {
	it("archives stale foos daily at 03:00 UTC as the foo-schedule actor", async () => {
		const fooStaleArchive = vi.fn(async () => ok(2));
		const schedule = fooSchedule({ fooStaleArchive } as unknown as FooUseCases);

		expect(schedule).toMatchObject({
			cron: "0 3 * * *",
			name: "foo.stale-archive",
		});
		await expect(schedule.run()).resolves.toEqual(ok(2));
		expect(fooStaleArchive).toHaveBeenCalledWith({
			id: "foo-schedule",
			kind: "client",
			scopes: [],
		});
	});
});

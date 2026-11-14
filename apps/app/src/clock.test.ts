import { describe, expect, it } from "vitest";
import { clockMemoryCreate, clockSystemCreate } from "./clock.ts";

describe("clock", () => {
	it("reads the system time", () => {
		const before = Date.now();
		const now = clockSystemCreate().now().getTime();
		expect(now).toBeGreaterThanOrEqual(before);
		expect(now).toBeLessThanOrEqual(Date.now());
	});

	it("stands still in memory until set or advanced", () => {
		const start = new Date("2026-01-01T00:00:00.000Z");
		const clock = clockMemoryCreate(start);
		expect(clock.now()).toEqual(start);
		expect(clock.now()).toEqual(start);
		clock.advance(60_000);
		expect(clock.now()).toEqual(new Date("2026-01-01T00:01:00.000Z"));
		clock.set(new Date("2026-02-01T00:00:00.000Z"));
		expect(clock.now()).toEqual(new Date("2026-02-01T00:00:00.000Z"));
	});

	it("hands out a copy, so a caller cannot move the time", () => {
		const clock = clockMemoryCreate(new Date("2026-01-01T00:00:00.000Z"));
		clock.now().setFullYear(2030);
		expect(clock.now()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
	});
});

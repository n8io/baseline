import { describe, expect, it } from "vitest";
import {
	type CiWatchCheck,
	ciWatch,
	ciWatchLineWrite,
	ciWatchStateRead,
} from "../scripts/ci-watch.ts";

const check = (
	name: string,
	status: string,
	conclusion: string | null,
): CiWatchCheck => ({ conclusion, name, status });

describe("ci-watch", () => {
	it("is green only when every check passed or was skipped", () => {
		expect(
			ciWatchStateRead([
				check("a", "completed", "success"),
				check("b", "completed", "skipped"),
			]),
		).toBe("green");
		expect(
			ciWatchStateRead([
				check("a", "completed", "success"),
				check("b", "in_progress", null),
			]),
		).toBe("pending");
		expect(ciWatchStateRead([])).toBe("pending");
	});

	it("is red at once for a failed or cancelled check", () => {
		for (const conclusion of ["failure", "cancelled", "timed_out"]) {
			expect(
				ciWatchStateRead([
					check("a", "completed", conclusion),
					check("b", "queued", null),
				]),
			).toBe("red");
		}
	});

	it("names the failed checks in its status line", () => {
		expect(
			ciWatchLineWrite([
				check("a", "completed", "success"),
				check("b", "in_progress", null),
				check("c", "completed", "cancelled"),
			]),
		).toBe("red: 1 passed, 1 running, 1 failed [c (cancelled)]");
	});

	it("re-runs a cancelled run once, then reports red if it is cancelled again", async () => {
		const calls: string[] = [];
		const cancelled = {
			conclusion: "cancelled",
			details_url: "https://github.com/o/r/actions/runs/77/job/1",
			name: "integration",
			status: "completed",
		};
		const lines: string[] = [];
		const code = await ciWatch({
			api: async (path, init) => {
				calls.push(`${init?.method ?? "GET"} ${path}`);
				if (path.includes("/pulls/")) return { head: { sha: "abc" } };
				return { check_runs: [cancelled] };
			},
			every: 0,
			pull: 5,
			repo: "o/r",
			sleep: async () => {},
			write: (line) => lines.push(line),
		});
		expect(code).toBe(1);
		expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
			"POST /repos/o/r/actions/runs/77/rerun-failed-jobs",
		]);
		expect(lines.some((l) => l.includes("re-running run 77 once"))).toBe(true);
	});
});

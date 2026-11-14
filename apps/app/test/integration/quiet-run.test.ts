import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A green run prints nothing at error level: a line that looks like a failure in a passing run
// teaches people to ignore real ones. Matches pino's error and fatal levels and git's `error:` lines.
const failureLine = /"level":(50|60)|^error:/m;

const runCapture = (
	script: string,
): { output: string; status: number | null } => {
	const result = spawnSync("pnpm", [script], {
		encoding: "utf8",
		timeout: 150_000,
	});
	return { output: `${result.stdout}${result.stderr}`, status: result.status };
};

describe("a green run", () => {
	it("prints no error-level line from the unit tests", {
		timeout: 180_000,
	}, () => {
		const { output, status } = runCapture("test");

		expect(status).toBe(0);
		expect(output.match(failureLine)?.[0]).toBeUndefined();
	});
});

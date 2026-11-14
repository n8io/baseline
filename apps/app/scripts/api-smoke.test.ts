import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { apiSmokeRoutesFind } from "./api-smoke.ts";

describe("apiSmokeRoutesFind", () => {
	it("keeps the GET routes without a path parameter, sorted", () => {
		expect(
			apiSmokeRoutesFind({
				paths: {
					"/things": { get: {}, post: {} },
					"/things/{thingId}": { get: {} },
					"/reports": { get: { parameters: [{ required: true }] } },
					"/search": { get: { parameters: [{ required: false }] } },
					"/parts": { get: {} },
					"/jobs": { post: {} },
				},
			}),
		).toEqual(["/parts", "/search", "/things"]);
	});

	it("finds nothing in a document without paths", () => {
		expect(apiSmokeRoutesFind({})).toEqual([]);
		expect(apiSmokeRoutesFind(null)).toEqual([]);
	});
});

describe("api-smoke --help", () => {
	it("prints the usage and exits 0 without touching the network", () => {
		const { status, stdout } = spawnSync(
			process.execPath,
			["scripts/api-smoke.ts", "--help"],
			{ encoding: "utf8" },
		);

		expect(stdout).toContain("Usage: pnpm api-smoke");
		expect(status).toBe(0);
	});
});

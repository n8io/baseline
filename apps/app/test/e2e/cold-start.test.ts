import { describe, expect, it } from "vitest";
import { e2eServerStart } from "./e2e-server.ts";

// The production build, started cold, serves its sign-in page within this budget. Measured: 2.5 to
// 3.0 s from spawn to the first 200 (Node, the preload and the build's imports). The budget is
// several times that, so a slow CI runner passes and a boot that regresses to a crawl fails.
const coldStartMsMax = 10_000;

describe("cold start", () => {
	it("serves the sign-in page within the budget", async () => {
		const started = performance.now();
		await using server = await e2eServerStart();
		const elapsedMs = performance.now() - started;
		const response = await fetch(`${server.url}/auth/sign-in`);
		expect(response.status).toBe(200);
		expect(elapsedMs).toBeLessThanOrEqual(coldStartMsMax);
	}, 30_000);
});

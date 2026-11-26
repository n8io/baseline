import lighthouse from "lighthouse";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type UiServer,
	uiServerPortFree,
	uiServerStart,
} from "../../scripts/ui-server.ts";

// The sign-in page's performance budget. Lighthouse drives the Chromium Playwright launched, over its
// debugging port, and throttles by simulation, so one run is stable. Baseline on the production build
// (three runs): score 1, FCP and LCP 617 to 645 ms, TBT 0 to 27 ms, CLS 0, 1,446 bytes in 1 request.
// Each budget leaves several times that headroom, so a CI runner's noise passes and a real regression
// (a blocking script, an unoptimized image, a layout shift) fails.
const budget = {
	bytes: 20_000,
	clsMax: 0.1,
	lcpMsMax: 1_500,
	requestsMax: 5,
	scoreMin: 0.9,
	tbtMsMax: 200,
} as const;

let server: UiServer;
let browser: Browser;
let port: number;

beforeAll(async () => {
	server = await uiServerStart();
	port = await uiServerPortFree();
	browser = await chromium.launch({
		args: [`--remote-debugging-port=${port}`],
	});
}, 60_000);

afterAll(async () => {
	await browser?.close();
	await server?.[Symbol.asyncDispose]();
});

describe("sign-in page performance budget", () => {
	it("stays within the Lighthouse budget", async () => {
		const result = await lighthouse(`${server.url}/auth/sign-in`, {
			logLevel: "error",
			onlyCategories: ["performance"],
			output: "json",
			port,
		});
		const lhr = result?.lhr;
		expect(lhr?.runtimeError).toBeUndefined();
		const numberOf = (id: string): number =>
			lhr?.audits[id]?.numericValue ?? Number.NaN;
		const requests = lhr?.audits["network-requests"]?.details;
		const requestCount =
			requests?.type === "table" ? requests.items.length : Number.NaN;
		const measured = {
			bytes: numberOf("total-byte-weight"),
			cls: numberOf("cumulative-layout-shift"),
			lcpMs: numberOf("largest-contentful-paint"),
			requests: requestCount,
			score: lhr?.categories["performance"]?.score ?? Number.NaN,
			tbtMs: numberOf("total-blocking-time"),
		};
		// A NaN fails every comparison below, so a missing audit fails the test instead of passing it.
		expect(measured.score).toBeGreaterThanOrEqual(budget.scoreMin);
		expect(measured.lcpMs).toBeLessThanOrEqual(budget.lcpMsMax);
		expect(measured.tbtMs).toBeLessThanOrEqual(budget.tbtMsMax);
		expect(measured.cls).toBeLessThanOrEqual(budget.clsMax);
		expect(measured.bytes).toBeLessThanOrEqual(budget.bytes);
		expect(measured.requests).toBeLessThanOrEqual(budget.requestsMax);
	}, 60_000);
});

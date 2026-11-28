import lighthouse from "lighthouse";
import { type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type UiServer,
	uiServerPortFree,
	uiServerStart,
} from "../../scripts/ui-server.ts";

// The app's own pages' performance budget: the list page and an entry's detail page. They sit behind
// sign-in, so Playwright signs in as the Dev user first; Lighthouse then drives the same Chromium over
// its debugging port and shares the persistent context's cookies. This is separate from the sign-in
// budget because these pages carry the whole React bundle, uncompressed. Baseline on main: list page
// 683,849 bytes in 11 requests, LCP 980 ms, TBT 0, CLS 0, score 1; detail page 726,141 bytes in 13
// requests, LCP 912 ms, TBT 1 ms, CLS 0, score 1. A smaller bundle or compression should lower the
// bytes later; tighten the budget then. The headroom absorbs a CI runner's noise.
const budget = {
	bytes: 900_000,
	clsMax: 0.1,
	lcpMsMax: 2_000,
	requestsMax: 16,
	scoreMin: 0.9,
	tbtMsMax: 300,
} as const;

let server: UiServer;
let context: BrowserContext;
let page: Page;
let port: number;
let detailUrl: string;

const detailPath = /^\/[^/]+\/[^/]+$/;

beforeAll(async () => {
	server = await uiServerStart();
	port = await uiServerPortFree();
	context = await chromium.launchPersistentContext("", {
		args: [`--remote-debugging-port=${port}`],
	});
	page = await context.newPage();
	await page.goto(`${server.url}/auth/sign-in`);
	await page.getByRole("button", { name: "Dev user" }).click();
	await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
	await page.getByLabel("Name").fill(`budget${Date.now().toString(36)}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL((url) => detailPath.test(url.pathname));
	detailUrl = page.url();
}, 60_000);

afterAll(async () => {
	await context?.close();
	await server?.[Symbol.asyncDispose]();
});

const measure = async (url: string) => {
	const result = await lighthouse(url, {
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
	return {
		bytes: numberOf("total-byte-weight"),
		cls: numberOf("cumulative-layout-shift"),
		lcpMs: numberOf("largest-contentful-paint"),
		requests: requests?.type === "table" ? requests.items.length : Number.NaN,
		score: lhr?.categories["performance"]?.score ?? Number.NaN,
		tbtMs: numberOf("total-blocking-time"),
	};
};

// A NaN fails every comparison, so a missing audit fails the test instead of passing it.
const withinBudget = (measured: Awaited<ReturnType<typeof measure>>) => {
	expect(measured.score).toBeGreaterThanOrEqual(budget.scoreMin);
	expect(measured.lcpMs).toBeLessThanOrEqual(budget.lcpMsMax);
	expect(measured.tbtMs).toBeLessThanOrEqual(budget.tbtMsMax);
	expect(measured.cls).toBeLessThanOrEqual(budget.clsMax);
	expect(measured.bytes).toBeLessThanOrEqual(budget.bytes);
	expect(measured.requests).toBeLessThanOrEqual(budget.requestsMax);
};

describe("app pages performance budget", () => {
	it("keeps the list page within the Lighthouse budget", async () => {
		withinBudget(await measure(`${server.url}/`));
	}, 60_000);

	it("keeps an entry's detail page within the Lighthouse budget", async () => {
		withinBudget(await measure(detailUrl));
	}, 60_000);
});

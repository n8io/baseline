import { type AxeResults, source as axeSource } from "axe-core";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2eServer, e2eServerStart } from "./e2e-server.ts";

// The sign-in page is the memory issuer's, in development and test. One Server and one browser serve
// every test here; Playwright records no trace unless a test starts one.
type Axe = { run: () => Promise<AxeResults> };

let server: E2eServer;
let browser: Browser;
let page: Page;
let consoleErrors: string[];

beforeAll(async () => {
	server = await e2eServerStart();
	browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
	await browser?.close();
	await server?.[Symbol.asyncDispose]();
});

describe("sign-in page", () => {
	beforeAll(async () => {
		page = await browser.newPage();
		consoleErrors = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => {
			consoleErrors.push(error.message);
		});
		const response = await page.goto(`${server.url}/auth/sign-in`);
		expect(response?.status()).toBe(200);
	});

	it("renders the heading and one button per Dev user", async () => {
		await expect.poll(() => page.title()).toBe("Sign in (local)");
		expect(await page.getByRole("heading", { name: "Sign in" }).count()).toBe(
			1,
		);
		expect(await page.getByRole("button", { name: "Dev user" }).count()).toBe(
			1,
		);
		expect(await page.getByRole("button", { name: "Dev admin" }).count()).toBe(
			1,
		);
	});

	it("logs no console errors", () => {
		expect(consoleErrors).toEqual([]);
	});

	it("has no serious or critical axe violations", async () => {
		await page.evaluate(axeSource);
		const { passes, violations } = await page.evaluate(() =>
			(globalThis as unknown as { axe: Axe }).axe.run(),
		);
		// Axe ran: it checked rules, it did not just return nothing.
		expect(passes.length).toBeGreaterThan(0);
		const blocking = violations.filter(
			({ impact }) => impact === "serious" || impact === "critical",
		);
		expect(blocking.map(({ id, impact }) => `${id} (${impact})`)).toEqual([]);
	});
});

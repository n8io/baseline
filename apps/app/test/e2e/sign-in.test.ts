import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type UiServer, uiServerStart } from "../../scripts/ui-server.ts";
import { axeBlocking } from "./axe-blocking.ts";

// The sign-in page is the memory issuer's, in development and test. One Server and one browser serve
// every test here; Playwright records no trace unless a test starts one.
let server: UiServer;
let browser: Browser;
let page: Page;
let consoleErrors: string[];

beforeAll(async () => {
	server = await uiServerStart();
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
		expect(await axeBlocking(page)).toEqual([]);
	});
});

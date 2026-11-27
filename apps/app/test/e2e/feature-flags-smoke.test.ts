import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type UiServer, uiServerStart } from "../../scripts/ui-server.ts";

// The feature-flags Piece's page renders and its client hydrates. A form submitted on a hydrated page
// navigates without a full load, so a marker set on the window survives it. Without a client-side ID
// the flags config is null and the page carries no config script, as in this test run.
// `pnpm piece-remove feature-flags` deletes this file with the Piece's client code.
let server: UiServer;
let browser: Browser;

beforeAll(async () => {
	server = await uiServerStart();
	browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
	await browser?.close();
	await server?.[Symbol.asyncDispose]();
});

describe("feature flags on the page", () => {
	it("hydrates the list with the feature flags piece in the page", async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		const consoleErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => consoleErrors.push(error.message));
		try {
			await page.goto(`${server.url}/auth/sign-in`);
			await page.getByRole("button", { name: "Dev user" }).click();
			await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
			await page.getByRole("heading", { name: "Foos" }).waitFor();

			const name = `flags${Math.random().toString(36).slice(2, 10)}`;
			await page.evaluate(() => {
				Object.assign(window, { marker: "still here" });
			});
			await page.getByLabel("Name").fill(name);
			await page.getByRole("button", { name: "Create" }).click();
			await page.getByText(name, { exact: true }).waitFor();
			expect(
				await page.evaluate(() => (window as { marker?: string }).marker),
			).toBe("still here");
			expect(consoleErrors).toEqual([]);
		} finally {
			await context.close();
		}
	});
});

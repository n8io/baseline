import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type UiServer, uiServerStart } from "../../scripts/ui-server.ts";

// The ui Piece's pages each render: the home redirect, the foo list and a foo's detail page. One
// page per test, a signed-in Actor, and no console errors. `pnpm piece-remove ui` deletes this file.
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

describe("ui pages render", () => {
	it("renders the home redirect, the foo list and a foo's detail page", async () => {
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

			await page.goto(`${server.url}/`);
			expect(new URL(page.url()).pathname).toBe("/foos");
			await page.getByRole("heading", { name: "Foos" }).waitFor();

			const name = `smoke${Math.random().toString(36).slice(2, 10)}`;
			await page.getByLabel("Name").fill(name);
			await page.getByRole("button", { name: "Create" }).click();
			await page.getByText(name, { exact: true }).waitFor();
			expect(new URL(page.url()).pathname).toMatch(/^\/foos\/.+/);

			expect(consoleErrors).toEqual([]);
		} finally {
			await context.close();
		}
	});
});

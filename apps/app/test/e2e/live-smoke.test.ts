import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type UiServer, uiServerStart } from "../../scripts/ui-server.ts";

// The live Piece's hook on a foo's detail page: the page opens its live stream once it renders, and the
// stream answers 200. `pnpm piece-remove live` deletes this file and the hook's lines in the page.
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

describe("live updates on an entry's detail page", () => {
	it("opens the entry's live stream once the page renders", async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto(`${server.url}/auth/sign-in`);
			await page.getByRole("button", { name: "Dev user" }).click();
			await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));

			const name = `live${Math.random().toString(36).slice(2, 10)}`;
			await page.getByLabel("Name").fill(name);
			await page.getByRole("button", { name: "Create" }).click();
			await page.getByText(name, { exact: true }).waitFor();

			const stream = page.waitForResponse((response) =>
				response.url().includes("/live/"),
			);
			await page.reload();
			expect((await stream).status()).toBe(200);
		} finally {
			await context.close();
		}
	});
});

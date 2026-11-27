import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type UiServer, uiServerStart } from "../../scripts/ui-server.ts";

// The api-reference Piece's page renders: Swagger UI at /api/v1/docs, with no sign-in. Its own file so
// `pnpm piece-remove api-reference` deletes it with the page.
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

describe("api reference page", () => {
	it("renders Swagger UI from the OpenAPI document", async () => {
		const page = await browser.newPage();
		const consoleErrors: string[] = [];
		page.on("pageerror", (error) => consoleErrors.push(error.message));
		try {
			const response = await page.goto(`${server.url}/api/v1/docs`);
			expect(response?.status()).toBe(200);
			await page.locator(".swagger-ui").waitFor();
			expect(consoleErrors).toEqual([]);
		} finally {
			await page.context().close();
		}
	});
});

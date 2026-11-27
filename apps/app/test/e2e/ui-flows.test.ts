import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type UiServer, uiServerStart } from "../../scripts/ui-server.ts";

// Click-through flows of the UI pieces: sign-in, the home redirect, the foo list and detail, and one
// create and one edit. One Server and one browser serve every flow; each flow signs in in a context of
// its own, so cookies never leak between them. Memory adapters: nothing persists between runs.
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

// A page in a context of its own, with the page's console errors collected.
const pageOpen = async (): Promise<{
	consoleErrors: string[];
	context: BrowserContext;
	page: Page;
}> => {
	const context = await browser.newContext();
	const page = await context.newPage();
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => {
		consoleErrors.push(error.message);
	});
	return { consoleErrors, context, page };
};

// Signs in as the Dev user through the sign-in page's button and waits until the app has left /auth.
const signIn = async (page: Page) => {
	await page.goto(`${server.url}/auth/sign-in`);
	await page.getByRole("button", { name: "Dev user" }).click();
	await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
};

// A name no other flow has used on this Server.
const nameCreate = () => `flow${Math.random().toString(36).slice(2, 10)}`;

describe("sign-in flow", () => {
	it("signs in as the Dev user and lands on the list", async () => {
		const { consoleErrors, context, page } = await pageOpen();
		try {
			await signIn(page);
			expect(new URL(page.url()).pathname).toBe("/foos");
			await page.getByRole("heading", { name: "Foos" }).waitFor();
			expect(consoleErrors).toEqual([]);
		} finally {
			await context.close();
		}
	});

	it("returns a signed-out visit to the page it asked for after sign-in", async () => {
		const { context, page } = await pageOpen();
		try {
			await page.goto(`${server.url}/foos`);
			await expect
				.poll(() => new URL(page.url()).pathname)
				.toBe("/auth/sign-in");
			await page.getByRole("button", { name: "Dev user" }).click();
			await expect.poll(() => new URL(page.url()).pathname).toBe("/foos");
		} finally {
			await context.close();
		}
	});
});

describe("home and list", () => {
	it("redirects the home page to the list", async () => {
		const { context, page } = await pageOpen();
		try {
			await signIn(page);
			await page.goto(`${server.url}/`);
			expect(new URL(page.url()).pathname).toBe("/foos");
			await page.getByRole("heading", { name: "Foos" }).waitFor();
		} finally {
			await context.close();
		}
	});
});

describe("create and edit", () => {
	it("creates an entry from the list and opens its detail page", async () => {
		const { consoleErrors, context, page } = await pageOpen();
		const name = nameCreate();
		try {
			await signIn(page);
			await page.getByLabel("Name").fill(name);
			await page.getByRole("button", { name: "Create" }).click();
			await expect
				.poll(() => new URL(page.url()).pathname)
				.toMatch(/^\/foos\/.+/);
			await page.getByText(name, { exact: true }).waitFor();
			expect(consoleErrors).toEqual([]);
		} finally {
			await context.close();
		}
	});

	it("lists the created entry, linked to its detail page", async () => {
		const { context, page } = await pageOpen();
		const name = nameCreate();
		try {
			await signIn(page);
			await page.getByLabel("Name").fill(name);
			await page.getByRole("button", { name: "Create" }).click();
			await expect
				.poll(() => new URL(page.url()).pathname)
				.toMatch(/^\/foos\/.+/);
			await page.goto(`${server.url}/foos`);
			await page.getByRole("link", { name }).click();
			await expect
				.poll(() => new URL(page.url()).pathname)
				.toMatch(/^\/foos\/.+/);
			await page.getByText(name, { exact: true }).waitFor();
		} finally {
			await context.close();
		}
	});

	it("edits the entry's name on its detail page", async () => {
		const { consoleErrors, context, page } = await pageOpen();
		const name = nameCreate();
		const renamed = nameCreate();
		try {
			await signIn(page);
			await page.getByLabel("Name").fill(name);
			await page.getByRole("button", { name: "Create" }).click();
			await expect
				.poll(() => new URL(page.url()).pathname)
				.toMatch(/^\/foos\/.+/);
			await page.getByLabel("Name").fill(renamed);
			await page.getByRole("button", { name: "Save" }).click();
			await page.getByText(renamed, { exact: true }).waitFor();
			expect(consoleErrors).toEqual([]);
		} finally {
			await context.close();
		}
	});
});

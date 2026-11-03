import type { Actor } from "@n8io/baseline-authn";
import { httpErrorHandle, httpRouterCreate } from "@n8io/baseline-http";
import { idCreate } from "@n8io/baseline-id";
import { liveMemory } from "@n8io/baseline-live";
import { afterEach, describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "../index.ts";
import { fooPortsCreate } from "../spi/index.ts";
import { fooLiveRoutes } from "./foo-live.ts";

const owner: Actor = { id: "user-1", kind: "user", scopes: [] };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map((close) => close()));
});

const setup = (
	options: { actor?: Actor; expiresAt?: number } = { actor: owner },
) => {
	const liveHub = liveMemory();
	closers.push(() => liveHub.close());
	const useCases = fooUseCasesCreate(
		fooPortsCreate({
			cache: "memory",
			database: "memory",
			liveHub,
			queue: "memory",
		}),
	);
	const app = httpRouterCreate();
	app.onError(httpErrorHandle);
	app.use(async (c, next) => {
		c.set("actor", options.actor);
		c.set("authnExpiresAt", options.expiresAt);
		await next();
	});
	app.route("/live/foo", fooLiveRoutes(useCases, liveHub));
	return { app, useCases };
};

// Reads an SSE body; `until(text)` reads on until the body holds `text` or the stream ends.
const sseReader = (res: Response) => {
	const reader = (res.body as ReadableStream<Uint8Array>).getReader();
	closers.push(() => reader.cancel());
	const decoder = new TextDecoder();
	let body = "";
	const until = async (text: string) => {
		while (!body.includes(text)) {
			const chunk = await reader.read();
			if (chunk.done) return { body, ended: true };
			body += decoder.decode(chunk.value, { stream: true });
		}
		return { body, ended: false };
	};
	return { until };
};

describe("GET /live/foo/:fooId", () => {
	it("sends ready, then a live update when the foo is updated", async () => {
		const { app, useCases } = setup();
		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;
		const fooId = created.value.id;

		const res = await app.request(`/live/foo/${fooId}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
		const stream = sseReader(res);
		expect((await stream.until("event: ready")).ended).toBe(false);
		// Without a token expiry the stream stays open past its first moments.
		await new Promise((resolve) => setTimeout(resolve, 50));

		const updated = await useCases.fooUpdate(owner, { fooId, name: "beta" });
		expect(updated.ok).toBe(true);
		const { body } = await stream.until("foo.updated");
		expect(body).toContain(
			`data: ${JSON.stringify({ id: fooId, type: "foo.updated" })}`,
		);
	});

	it("closes at the token expiry with a retry", async () => {
		const { app, useCases } = setup({
			actor: owner,
			expiresAt: Date.now() - 1,
		});
		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;

		const res = await app.request(`/live/foo/${created.value.id}`);
		// No ready text is awaited: the stream must end by itself.
		const { body, ended } = await sseReader(res).until("never sent");
		expect(ended).toBe(true);
		expect(body).toMatch(/retry: \d+/);
	});

	it("answers a foo that does not exist with a 404 problem", async () => {
		const { app } = setup();
		const res = await app.request(`/live/foo/${idCreate("foo")}`);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toStrictEqual({
			code: "FooNotFound",
			status: 404,
			title: "Not Found",
		});
	});

	it("answers a malformed id with a 404 problem", async () => {
		const { app } = setup();
		const res = await app.request("/live/foo/not-a-foo-id");
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ code: "FooNotFound" });
	});

	it("answers 401 without an actor", async () => {
		const { app } = setup({});
		const res = await app.request(`/live/foo/${idCreate("foo")}`);
		expect(res.status).toBe(401);
	});
});

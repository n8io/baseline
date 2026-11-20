import { authnMemoryTokenFetch } from "@n8io/baseline-authn";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	fooCreate,
	fooDelete,
	fooGet,
	fooList,
	fooUpdate,
	sdkConfigure,
} from "../../clients/sdk/index.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

// The generated SDK against the production build on memory adapters.
let server: ProductionServer;
let token: string;

beforeAll(async () => {
	server = await productionServerStart({ databaseUrl: "memory://" });
	const { authorization } = await authnMemoryTokenFetch({
		clientId: "dev-client",
		baseUrl: server.url,
	});
	token = authorization.replace(/^Bearer /, "");
	// The random port's URL is the override environments leave for tests.
	sdkConfigure({ baseUrl: server.url, token });
}, 30_000);

afterAll(async () => {
	await server?.stop();
});

describe("the SDK on the production build", { timeout: 30_000 }, () => {
	it("creates, reads, lists, updates and deletes a Foo, typed by status", async () => {
		const created = await fooCreate({ name: "Alpha" });
		expect(created.status).toBe(201);
		if (created.status !== 201) return;
		expect(created.data).toMatchObject({ name: "Alpha" });
		const { id } = created.data;

		const read = await fooGet(id);
		expect(read).toMatchObject({ data: { id, name: "Alpha" }, status: 200 });

		const listed = await fooList({ limit: 10 });
		expect(listed.status).toBe(200);
		expect(listed.data.items.map((foo) => foo.id)).toContain(id);
		// A boolean query parameter is a boolean in the SDK, sent as ?count=true.
		const counted = await fooList({ count: true, limit: 10 });
		expect(counted.status).toBe(200);
		expect(counted.data.total).toBeGreaterThanOrEqual(1);

		const updated = await fooUpdate(id, { name: "Beta" });
		expect(updated).toMatchObject({ data: { name: "Beta" }, status: 200 });

		const missing = await fooGet("foo_00000000000000000000000000");
		expect(missing).toMatchObject({
			data: { code: "FooNotFound" },
			status: 404,
		});
		const deleted = await fooDelete(id);
		expect(deleted.status).toBe(204);
		expect((await fooGet(id)).status).toBe(404);
	});

	it("takes a URL and token for one call over the configured ones", async () => {
		const refused = await fooList(undefined, { token: "not-a-token" });
		expect(refused.status).toBe(401);

		const missing = await fooList(undefined, {
			baseUrl: `${server.url}/nowhere`,
		});
		expect(missing.status).toBe(404);
	});

	it("sends a call to the Environment it names, over the configured URL", async () => {
		const created = await fooCreate({ name: "Here only" });
		if (created.status !== 201) throw new Error(`fooCreate: ${created.status}`);
		// development is http://localhost:3000 (clients/environments.json): refused when nothing
		// listens there, else answered by a server that does not hold this foo (pnpm dev's).
		const outcome = await fooGet(created.data.id, {
			environment: "development",
			retry: 0,
		}).catch((error: Error) => error);
		if (outcome instanceof Error) {
			// Where localhost is both ::1 and 127.0.0.1, Node gives one error per address.
			const cause = outcome.cause as { errors?: unknown[] };
			expect(cause.errors ?? [cause]).toContainEqual(
				expect.objectContaining({ code: "ECONNREFUSED", port: 3000 }),
			);
		} else {
			expect(outcome.status).not.toBe(200);
		}
	});
});

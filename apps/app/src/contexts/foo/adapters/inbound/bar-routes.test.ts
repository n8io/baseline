import type { Actor } from "@n8io/baseline-authn";
import { httpErrorHandle, httpRouterCreate } from "@n8io/baseline-http";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "../../application/foo-use-cases.ts";
import { fooPortsMemoryCreate } from "../outbound/foo-ports.memory.ts";
import { barRoutesCreate } from "./bar-routes.ts";

const owner: Actor = { id: "user-1", kind: "user", scopes: [] };
const stranger: Actor = { id: "user-2", kind: "user", scopes: [] };

const setup = async () => {
	const useCases = fooUseCasesCreate(fooPortsMemoryCreate().ports);
	const foo = await useCases.fooCreate(owner, { name: "alpha" });
	if (!foo.ok) throw foo.error;
	let actor: Actor = owner;
	const app = httpRouterCreate();
	app.onError(httpErrorHandle);
	app.use(async (c, next) => {
		c.set("actor", actor);
		await next();
	});
	app.route("/", barRoutesCreate(useCases));
	const send = (path: string, body?: unknown) =>
		app.request(path, {
			body: body === undefined ? null : JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: body === undefined ? "GET" : "POST",
		});
	return {
		as: (next: Actor) => {
			actor = next;
		},
		fooId: foo.value.id,
		send,
	};
};

describe("POST /{fooId}/bars", () => {
	it("adds a bar and answers 201 with an RFC 3339 date", async () => {
		const { fooId, send } = await setup();
		const res = await send(`/${fooId}/bars`, { text: "first" });

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({
			createdAt: expect.stringMatching(/Z$/),
			createdBy: owner.id,
			fooId,
			id: expect.stringMatching(/^bar_/),
			text: "first",
		});
	});

	it("answers 403 to a stranger", async () => {
		const { as, fooId, send } = await setup();
		as(stranger);

		expect((await send(`/${fooId}/bars`, { text: "first" })).status).toBe(403);
	});

	it("answers 404 for a foo that does not exist, and 400 for no text", async () => {
		const { fooId, send } = await setup();

		expect(
			(await send(`/${idCreate("foo")}/bars`, { text: "first" })).status,
		).toBe(404);
		expect((await send(`/${fooId}/bars`, {})).status).toBe(400);
	});
});

describe("GET /{fooId}/bars", () => {
	it("lists the foo's bars", async () => {
		const { fooId, send } = await setup();
		await send(`/${fooId}/bars`, { text: "first" });

		const res = await send(`/${fooId}/bars`);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			items: [expect.objectContaining({ fooId, text: "first" })],
		});
	});

	it("answers 404 for a foo that does not exist", async () => {
		const { send } = await setup();

		expect((await send(`/${idCreate("foo")}/bars`)).status).toBe(404);
	});
});

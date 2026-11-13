import type { Actor } from "@n8io/baseline-authn";
import { httpErrorHandle, httpRouterCreate } from "@n8io/baseline-http";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "../index.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooRoutesCreate } from "./foo-routes.ts";

const owner: Actor = { id: "user-1", kind: "user", scopes: [] };
const stranger: Actor = { id: "user-2", kind: "user", scopes: [] };

const setup = () => {
	const useCases = fooUseCasesCreate(fooPortsMemoryCreate().ports);
	let actor: Actor | undefined = owner;
	const app = httpRouterCreate();
	app.onError(httpErrorHandle);
	app.use(async (c, next) => {
		if (actor) c.set("actor", actor);
		await next();
	});
	app.route("/", fooRoutesCreate(useCases));
	const send = ({
		body,
		method = "GET",
		path,
	}: {
		body?: unknown;
		method?: string;
		path: string;
	}) =>
		app.request(path, {
			body: body === undefined ? null : JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method,
		});
	const create = async (name: string) =>
		(await (
			await send({ path: "/", method: "POST", body: { name } })
		).json()) as { id: string };
	return {
		app,
		as: (next: Actor | undefined) => {
			actor = next;
		},
		create,
		send,
	};
};

const problem = ({
	code,
	status,
	title,
}: {
	code: string;
	status: number;
	title: string;
}) => ({
	code,
	status,
	title,
});

describe("POST /", () => {
	it("creates a foo and answers 201 with RFC 3339 dates", async () => {
		const { send } = setup();
		const res = await send({
			path: "/",
			method: "POST",
			body: { name: "alpha" },
		});

		expect(res.status).toBe(201);
		expect(await res.json()).toStrictEqual({
			archivedAt: null,
			createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
			createdBy: "user-1",
			id: expect.stringMatching(/^foo_/),
			name: "alpha",
			updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
		});
	});

	it("answers a duplicate name with a 409 problem", async () => {
		const { create, send } = setup();
		await create("alpha");
		const res = await send({
			path: "/",
			method: "POST",
			body: { name: "alpha" },
		});

		expect(res.status).toBe(409);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toStrictEqual(
			problem({ status: 409, title: "Conflict", code: "FooNameTaken" }),
		);
	});

	it("rejects an unknown body key with 400 ValidationFailed", async () => {
		const { send } = setup();
		const res = await send({
			path: "/",
			method: "POST",
			body: { extra: 1, name: "alpha" },
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			code: "ValidationFailed",
			status: 400,
		});
	});

	it.each(["POST", "PATCH"])(
		"rejects %s without a body or Content-Type with 400",
		async (method) => {
			const { app, create } = setup();
			const { id } = await create("alpha");
			const path = method === "POST" ? "/" : `/${id}`;
			const res = await app.request(path, { method });

			expect(res.status).toBe(400);
		},
	);

	it("answers 401 AuthnRequired without an actor", async () => {
		const { as, send } = setup();
		as(undefined);
		const res = await send({
			path: "/",
			method: "POST",
			body: { name: "alpha" },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({
			code: "AuthnRequired",
			status: 401,
		});
	});
});

describe("GET /", () => {
	it("lists foos without a total", async () => {
		const { create, send } = setup();
		await create("alpha");
		const res = await send({ path: "/" });

		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual({
			items: [expect.objectContaining({ name: "alpha" })],
			nextCursor: null,
		});
	});

	it("adds total with count=true", async () => {
		const { create, send } = setup();
		await create("alpha");
		await create("beta");
		const body = await (await send({ path: "/?count=true" })).json();

		expect(body).toMatchObject({ total: 2 });
	});

	it.each(["/?limit=0", "/?count=yes"])("rejects %s with 400", async (path) => {
		const { send } = setup();
		const res = await send({ path });

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "ValidationFailed" });
	});

	it("sorts, filters and pages with nextCursor", async () => {
		const { create, send } = setup();
		for (const name of ["a", "b", "c"]) await create(name);
		const query = "archived=false&sort=name&limit=2";
		const first = (await (await send({ path: `/?${query}` })).json()) as {
			items: { name: string }[];
			nextCursor: string;
		};

		expect(first.items.map((i) => i.name)).toStrictEqual(["a", "b"]);
		expect(first.nextCursor).toEqual(expect.any(String));

		const second = (await (
			await send({
				path: `/?${query}&cursor=${encodeURIComponent(first.nextCursor)}`,
			})
		).json()) as { items: { name: string }[]; nextCursor: string | null };

		expect(second.items.map((i) => i.name)).toStrictEqual(["c"]);
		expect(second.nextCursor).toBeNull();
	});
});

describe("GET /{fooId}", () => {
	it("returns the foo", async () => {
		const { create, send } = setup();
		const { id } = await create("alpha");
		const res = await send({ path: `/${id}` });

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id, name: "alpha" });
	});

	it("answers 404 FooNotFound for an unknown id", async () => {
		const { send } = setup();
		const res = await send({ path: `/${idCreate("foo")}` });

		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		expect(await res.json()).toStrictEqual(
			problem({ status: 404, title: "Not Found", code: "FooNotFound" }),
		);
	});

	it.each(["nope", "bar_0123456789abcdef"])(
		"rejects id %s with 400",
		async (id) => {
			const { send } = setup();
			const res = await send({ path: `/${id}` });

			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ code: "ValidationFailed" });
		},
	);
});

describe("PATCH /{fooId}", () => {
	it("renames the foo", async () => {
		const { create, send } = setup();
		const { id } = await create("alpha");
		const res = await send({
			path: `/${id}`,
			method: "PATCH",
			body: { name: "beta" },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id, name: "beta" });
	});

	it("answers 404 FooNotFound", async () => {
		const { send } = setup();
		const res = await send({
			path: `/${idCreate("foo")}`,
			method: "PATCH",
			body: { name: "beta" },
		});

		expect(res.status).toBe(404);
		expect(await res.json()).toStrictEqual(
			problem({ status: 404, title: "Not Found", code: "FooNotFound" }),
		);
	});

	it("answers 409 FooNameTaken", async () => {
		const { create, send } = setup();
		const { id } = await create("alpha");
		await create("beta");
		const res = await send({
			path: `/${id}`,
			method: "PATCH",
			body: { name: "beta" },
		});

		expect(res.status).toBe(409);
		expect(await res.json()).toStrictEqual(
			problem({ status: 409, title: "Conflict", code: "FooNameTaken" }),
		);
	});

	it("answers 403 FooForbidden for a stranger", async () => {
		const { as, create, send } = setup();
		const { id } = await create("alpha");
		as(stranger);
		const res = await send({
			path: `/${id}`,
			method: "PATCH",
			body: { name: "beta" },
		});

		expect(res.status).toBe(403);
		expect(await res.json()).toStrictEqual(
			problem({ status: 403, title: "Forbidden", code: "FooForbidden" }),
		);
	});
});

describe("DELETE /{fooId}", () => {
	it("deletes the foo and answers 204 with no body", async () => {
		const { create, send } = setup();
		const { id } = await create("alpha");
		const res = await send({ path: `/${id}`, method: "DELETE" });

		expect(res.status).toBe(204);
		expect(await res.text()).toBe("");
		expect((await send({ path: `/${id}` })).status).toBe(404);
	});

	it("answers 404 FooNotFound", async () => {
		const { send } = setup();
		const res = await send({ path: `/${idCreate("foo")}`, method: "DELETE" });

		expect(res.status).toBe(404);
		expect(await res.json()).toStrictEqual(
			problem({ status: 404, title: "Not Found", code: "FooNotFound" }),
		);
	});

	it("answers 403 FooForbidden for a stranger", async () => {
		const { as, create, send } = setup();
		const { id } = await create("alpha");
		as(stranger);
		const res = await send({ path: `/${id}`, method: "DELETE" });

		expect(res.status).toBe(403);
		expect(await res.json()).toStrictEqual(
			problem({ status: 403, title: "Forbidden", code: "FooForbidden" }),
		);
	});
});

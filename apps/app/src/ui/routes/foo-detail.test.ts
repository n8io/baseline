import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { liveMemory } from "@n8io/baseline-live";
import { describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "#domains/foo/index.ts";
import { fooPortsCreate } from "#domains/foo/spi/index.ts";
import { fooUseCasesContext } from "#ui/context.ts";
import { action, loader } from "#ui/routes/foo-detail.tsx";
import { routeArgs, routerContextCreate } from "./router-test-context.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "stranger", kind: "user", scopes: [] };

const setup = async (actor: Actor | null = owner) => {
	const useCases = fooUseCasesCreate(
		fooPortsCreate({
			cache: "memory",
			database: "memory",
			liveHub: liveMemory(),
			queue: "memory",
		}),
	);
	const created = await useCases.fooCreate(owner, { name: "alpha" });
	if (!created.ok) {
		throw created.error;
	}
	const context = routerContextCreate(actor ?? undefined, [
		[fooUseCasesContext, useCases],
	]);
	return { context, foo: created.value, useCases };
};

type Context = Awaited<ReturnType<typeof setup>>["context"];
const getArgs = (context: Context, fooId: string) =>
	routeArgs({
		context,
		params: { fooId },
		url: `/foos/${fooId}`,
	});
const postArgs = (
	context: Context,
	fooId: string,
	form: Record<string, string>,
) =>
	routeArgs({
		context,
		form,
		params: { fooId },
		url: `/foos/${fooId}`,
	});

const thrown = async (run: () => unknown): Promise<unknown> => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	return undefined;
};

describe("foo detail loader", () => {
	it("returns the foo", async () => {
		const { context, foo } = await setup();
		const result = await loader(getArgs(context, foo.id));
		expect(result.foo.name).toBe("alpha");
	});

	it("throws 404 for a malformed id", async () => {
		const { context } = await setup();
		const error = await thrown(() => loader(getArgs(context, "nope")));
		expect(error).toMatchObject({
			data: { type: "FooNotFound" },
			init: { status: 404 },
		});
	});

	it("throws 404 FooNotFound for an unknown id", async () => {
		const { context } = await setup();
		const error = await thrown(() => loader(getArgs(context, idCreate("foo"))));
		expect(error).toMatchObject({
			data: { type: "FooNotFound" },
			init: { status: 404 },
		});
	});

	it("redirects to sign-in without an actor", async () => {
		const { context, foo } = await setup(null);
		const error = await thrown(() => loader(getArgs(context, foo.id)));
		expect(error).toBeInstanceOf(Response);
		expect((error as Response).status).toBe(302);
		expect((error as Response).headers.get("Location")).toBe(
			`/auth/sign-in?returnTo=${encodeURIComponent(`/foos/${foo.id}`)}`,
		);
	});
});

describe("foo detail action update", () => {
	it("renames the foo", async () => {
		const { context, foo, useCases } = await setup();
		const result = await action(
			postArgs(context, foo.id, { intent: "update", name: "beta" }),
		);
		expect(result).toEqual({ ok: true });
		const got = await useCases.fooGet(owner, { fooId: foo.id });
		expect(got.ok && got.value.name).toBe("beta");
	});

	it("returns 400 for an empty name", async () => {
		const { context, foo } = await setup();
		const result = await action(
			postArgs(context, foo.id, { intent: "update", name: "" }),
		);
		expect(result).toMatchObject({
			data: { values: { name: "" } },
			init: { status: 400 },
		});
	});

	it("returns 409 for a taken name", async () => {
		const { context, foo, useCases } = await setup();
		await useCases.fooCreate(owner, { name: "beta" });
		const result = await action(
			postArgs(context, foo.id, { intent: "update", name: "beta" }),
		);
		expect(result).toMatchObject({
			data: { errors: { name: ["A foo named beta already exists"] } },
			init: { status: 409 },
		});
	});

	it("throws 403 for a stranger", async () => {
		const { context, foo } = await setup(stranger);
		const error = await thrown(() =>
			action(postArgs(context, foo.id, { intent: "update", name: "beta" })),
		);
		expect(error).toMatchObject({
			data: { type: "FooForbidden" },
			init: { status: 403 },
		});
	});
});

describe("foo detail action delete", () => {
	it("deletes the foo and redirects to the list", async () => {
		const { context, foo, useCases } = await setup();
		const result = (await action(
			postArgs(context, foo.id, { intent: "delete" }),
		)) as Response;
		expect(result.status).toBe(302);
		expect(result.headers.get("Location")).toBe("/foos");
		const got = await useCases.fooGet(owner, { fooId: foo.id });
		expect(got.ok).toBe(false);
	});

	it("throws 403 for a stranger", async () => {
		const { context, foo, useCases } = await setup(stranger);
		const error = await thrown(() =>
			action(postArgs(context, foo.id, { intent: "delete" })),
		);
		expect(error).toMatchObject({
			data: { type: "FooForbidden" },
			init: { status: 403 },
		});
		const got = await useCases.fooGet(owner, { fooId: foo.id });
		expect(got.ok).toBe(true);
	});

	it("throws 404 for an unknown foo", async () => {
		const { context } = await setup();
		const error = await thrown(() =>
			action(postArgs(context, idCreate("foo"), { intent: "delete" })),
		);
		expect(error).toMatchObject({ init: { status: 404 } });
	});
});

describe("foo detail action intent", () => {
	it("throws 400 for an unknown intent", async () => {
		const { context, foo } = await setup();
		const error = await thrown(() =>
			action(postArgs(context, foo.id, { intent: "nope" })),
		);
		expect(error).toMatchObject({
			data: { type: "ValidationFailed" },
			init: { status: 400 },
		});
	});
});

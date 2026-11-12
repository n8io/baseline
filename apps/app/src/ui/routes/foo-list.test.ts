import type { Actor } from "@n8io/baseline-authn";
import { liveHubMemoryCreate } from "@n8io/baseline-live";
import { describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "#domains/foo/index.ts";
import { fooPortsCreate } from "#domains/foo/spi/index.ts";
import { fooUseCasesContext } from "#ui/context.ts";
import { action, loader } from "#ui/routes/foo-list.tsx";
import { routeArgs, routerContextCreate } from "./router-test-context.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };

const setup = (actor: Actor | null = owner) => {
	const useCases = fooUseCasesCreate(
		fooPortsCreate({
			// piece-start: cache
			cache: "memory",
			// piece-end: cache
			database: "memory",
			// piece-start: live
			liveHub: liveHubMemoryCreate(),
			// piece-end: live
			queue: "memory",
		}),
	);
	const context = routerContextCreate(actor ?? undefined, [
		[fooUseCasesContext, useCases],
	]);
	return { context, useCases };
};

const listArgs = (
	context: ReturnType<typeof setup>["context"],
	url = "/foos",
) => routeArgs({ context, url });
const postArgs = (
	context: ReturnType<typeof setup>["context"],
	form: Record<string, string>,
) => routeArgs({ context, form, url: "/foos" }) as Parameters<typeof action>[0];

const thrown = async (run: () => unknown): Promise<unknown> => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	return undefined;
};

describe("foo list loader", () => {
	it("returns created foos", async () => {
		const { context, useCases } = setup();
		await useCases.fooCreate(owner, { name: "alpha" });
		await useCases.fooCreate(owner, { name: "beta" });
		const result = await loader(listArgs(context));
		expect(result.items.map((foo) => foo.name).sort()).toEqual([
			"alpha",
			"beta",
		]);
		expect(result.nextCursor).toBeNull();
	});

	it("falls back to the first page for an undecodable cursor", async () => {
		const { context, useCases } = setup();
		await useCases.fooCreate(owner, { name: "alpha" });
		const result = await loader(listArgs(context, "/foos?cursor=%25garbage"));
		expect(result.items).toHaveLength(1);
		expect(result.nextCursor).toBeNull();
	});

	it("redirects to sign-in without an actor", async () => {
		const { context } = setup(null);
		const error = await thrown(() => loader(listArgs(context)));
		expect(error).toBeInstanceOf(Response);
		expect((error as Response).status).toBe(302);
		expect((error as Response).headers.get("Location")).toBe(
			`/auth/sign-in?returnTo=${encodeURIComponent("/foos")}`,
		);
	});
});

describe("foo list action", () => {
	it("redirects to sign-in without an actor", async () => {
		const { context } = setup(null);
		const error = await thrown(() => action(postArgs(context, { name: "x" })));
		expect(error).toBeInstanceOf(Response);
		expect((error as Response).headers.get("Location")).toBe(
			`/auth/sign-in?returnTo=${encodeURIComponent("/foos")}`,
		);
	});

	it("returns 400 with field errors and values for an empty name", async () => {
		const { context } = setup();
		const result = await action(postArgs(context, { name: "" }));
		expect(result).toMatchObject({
			data: { values: { name: "" } },
			init: { status: 400 },
		});
		expect(
			(result as { data: { errors: { name?: string[] } } }).data.errors.name
				?.length,
		).toBeGreaterThan(0);
	});

	it("returns 409 for a duplicate name", async () => {
		const { context, useCases } = setup();
		await useCases.fooCreate(owner, { name: "alpha" });
		const result = await action(postArgs(context, { name: "alpha" }));
		expect(result).toMatchObject({
			data: {
				errors: { name: ["A foo named alpha already exists"] },
				values: { name: "alpha" },
			},
			init: { status: 409 },
		});
	});

	it("creates the foo and redirects to it", async () => {
		const { context, useCases } = setup();
		const result = (await action(
			postArgs(context, { name: "alpha" }),
		)) as Response;
		expect(result.status).toBe(302);
		const location = result.headers.get("Location") ?? "";
		expect(location).toMatch(/^\/foos\/.+/);
		const listed = await useCases.fooList(owner, {
			archived: false,
			count: false,
			limit: 50,
			sort: "-createdAt",
		});
		expect(
			listed.ok && listed.value.items.map((foo) => `/foos/${foo.id}`),
		).toEqual([location]);
	});
});

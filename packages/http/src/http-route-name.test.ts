import { createRoute, z } from "@hono/zod-openapi";
import {
	context,
	INVALID_SPAN_CONTEXT,
	type Span,
	trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	httpErrorHandleCreate,
	httpNotFoundHandle,
	httpRouteName,
	httpRouterCreate,
} from "./index.ts";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

// A span that records what the middleware does to it.
const spanFake = () => {
	const attributes: [string, unknown][] = [];
	const names: string[] = [];
	const span = {
		attributes,
		names,
		setAttribute: (key: string, value: unknown) => {
			attributes.push([key, value]);
		},
		spanContext: () => INVALID_SPAN_CONTEXT,
		updateName: (name: string) => {
			names.push(name);
		},
	};
	return span;
};

const fooListRoute = createRoute({
	method: "get",
	path: "/",
	request: { query: z.object({ limit: z.coerce.number().int().max(100) }) },
	responses: { 200: { description: "OK" } },
});

const appCreate = (span: ReturnType<typeof spanFake> | null = null) => {
	const foos = httpRouterCreate()
		.openapi(fooListRoute, (c) => c.body(null, 200))
		.get("/:fooId", (c) => c.text("foo"))
		.delete("/:fooId", () => {
			throw new Error("boom");
		})
		.post("/", (c) => c.body(null, 201));
	const app = new Hono();
	// What the HTTP instrumentation does for a traced request: the handler runs inside its span.
	if (span !== null) {
		app.use((_c, next) =>
			context.with(
				trace.setSpan(context.active(), span as unknown as Span),
				next,
			),
		);
	}
	app.use(httpRouteName);
	app.onError(httpErrorHandleCreate({ logger: { error: () => undefined } }));
	app.route("/api/v1/foos", foos);
	app.all("/api/*", httpNotFoundHandle);
	app.get("*", (c) => c.text("page"));
	return app;
};

describe("httpRouteName", () => {
	it.each([
		{
			method: "GET",
			name: "GET /api/v1/foos/:fooId",
			path: "/api/v1/foos/foo_1",
			route: "/api/v1/foos/:fooId",
		},
		{
			method: "POST",
			name: "POST /api/v1/foos",
			path: "/api/v1/foos",
			route: "/api/v1/foos",
		},
	])(
		"names the server span for $method $path after the route that answered",
		async ({ method, name, path, route }) => {
			const span = spanFake();
			const res = await appCreate(span).request(path, { method });

			expect(res.ok).toBe(true);
			expect(span.names).toStrictEqual([name]);
			expect(span.attributes).toStrictEqual([["http.route", route]]);
		},
	);

	it.each([
		{
			method: "DELETE",
			name: "DELETE /api/v1/foos/:fooId",
			path: "/api/v1/foos/foo_1",
			status: 500,
		},
		{
			method: "GET",
			name: "GET /api/v1/foos",
			path: "/api/v1/foos?limit=999",
			status: 400,
		},
	])(
		"still names the span when $method $path answers $status",
		async ({ method, name, path, status }) => {
			const span = spanFake();
			const res = await appCreate(span).request(path, { method });

			expect(res.status).toBe(status);
			expect(span.names).toStrictEqual([name]);
		},
	);

	it.each(["/api/v1/nope", "/foos/foo_1"])(
		"leaves the span alone when a catch-all route answers %s",
		async (path) => {
			const span = spanFake();
			await appCreate(span).request(path);

			expect(span.names).toStrictEqual([]);
			expect(span.attributes).toStrictEqual([]);
		},
	);

	it("does nothing without an active span", async () => {
		const res = await appCreate().request("/api/v1/foos/foo_1");

		expect(trace.getActiveSpan()).toBeUndefined();
		expect(await res.text()).toBe("foo");
	});
});

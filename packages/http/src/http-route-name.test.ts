import { createRoute, z } from "@hono/zod-openapi";
import { logger } from "@n8io/baseline-logger";
import { INVALID_SPAN_CONTEXT, type Span, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	httpErrorHandle,
	httpNotFoundHandle,
	httpRouteName,
	httpRouterCreate,
} from "./index.ts";

const spanFake = () => {
	const span = {
		setAttribute: vi.fn(),
		spanContext: () => INVALID_SPAN_CONTEXT,
		updateName: vi.fn(),
	};
	vi.spyOn(trace, "getActiveSpan").mockReturnValue(span as unknown as Span);
	return span;
};

const fooListRoute = createRoute({
	method: "get",
	path: "/",
	request: { query: z.object({ limit: z.coerce.number().int().max(100) }) },
	responses: { 200: { description: "OK" } },
});

const appCreate = () => {
	const foos = httpRouterCreate()
		.openapi(fooListRoute, (c) => c.body(null, 200))
		.get("/:fooId", (c) => c.text("foo"))
		.delete("/:fooId", () => {
			throw new Error("boom");
		})
		.post("/", (c) => c.body(null, 201));
	const app = new Hono();
	app.use(httpRouteName);
	app.onError(httpErrorHandle);
	app.route("/api/v1/foos", foos);
	app.all("/api/*", httpNotFoundHandle);
	app.get("*", (c) => c.text("page"));
	return app;
};

describe("httpRouteName", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		[
			"GET",
			"/api/v1/foos/foo_1",
			"GET /api/v1/foos/:fooId",
			"/api/v1/foos/:fooId",
		],
		["POST", "/api/v1/foos", "POST /api/v1/foos", "/api/v1/foos"],
	])(
		"names the server span for %s %s after the route that answered",
		async (method, path, name, route) => {
			const span = spanFake();
			const res = await appCreate().request(path, { method });

			expect(res.ok).toBe(true);
			expect(span.updateName).toHaveBeenCalledExactlyOnceWith(name);
			expect(span.setAttribute).toHaveBeenCalledExactlyOnceWith(
				"http.route",
				route,
			);
		},
	);

	it.each([
		["DELETE", "/api/v1/foos/foo_1", 500, "DELETE /api/v1/foos/:fooId"],
		["GET", "/api/v1/foos?limit=999", 400, "GET /api/v1/foos"],
	])(
		"still names the span when %s %s answers %i",
		async (method, path, status, name) => {
			vi.spyOn(logger, "error").mockImplementation(() => undefined);
			const span = spanFake();
			const res = await appCreate().request(path, { method });

			expect(res.status).toBe(status);
			expect(span.updateName).toHaveBeenCalledExactlyOnceWith(name);
		},
	);

	it.each(["/api/v1/nope", "/foos/foo_1"])(
		"leaves the span alone when a catch-all route answers %s",
		async (path) => {
			const span = spanFake();
			await appCreate().request(path);

			expect(span.updateName).not.toHaveBeenCalled();
			expect(span.setAttribute).not.toHaveBeenCalled();
		},
	);

	it("does nothing without an active span", async () => {
		const res = await appCreate().request("/api/v1/foos/foo_1");

		expect(trace.getActiveSpan()).toBeUndefined();
		expect(await res.text()).toBe("foo");
	});
});

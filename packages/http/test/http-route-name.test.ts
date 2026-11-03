import { type Span, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	httpNotFoundHandle,
	httpRouteName,
	httpRouterCreate,
} from "../src/index.ts";

const spanFake = () => {
	const span = { setAttribute: vi.fn(), updateName: vi.fn() };
	vi.spyOn(trace, "getActiveSpan").mockReturnValue(span as unknown as Span);
	return span;
};

const appCreate = () => {
	const foos = httpRouterCreate()
		.get("/:fooId", (c) => c.text("foo"))
		.post("/", (c) => c.body(null, 201));
	const app = new Hono();
	app.use(httpRouteName);
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

import { logger } from "@n8io/baseline-logger";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpErrorHandle, httpNotFoundHandle } from "../src/index.ts";

const canary = "canary@example.com";

class AuthnRequiredError extends Error {
	readonly httpStatus = 401;
	readonly type = "AuthnRequired";
}

const appThrowing = (error: unknown) => {
	const app = new Hono();
	app.onError(httpErrorHandle);
	app.notFound(httpNotFoundHandle);
	app.get("/foos/:fooId", () => {
		throw error;
	});
	return app;
};

describe("httpErrorHandle", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("answers any other thrown error 500 InternalError and logs it once", async () => {
		const error = new TypeError(canary);
		const logError = vi
			.spyOn(logger, "error")
			.mockImplementation(() => undefined);
		const res = await appThrowing(error).request("/foos/foo_1");
		const text = await res.text();

		expect(res.status).toBe(500);
		expect(res.headers.get("Content-Type")).toBe("application/problem+json");
		expect(JSON.parse(text)).toStrictEqual({
			code: "InternalError",
			status: 500,
			title: "Internal Server Error",
		});
		expect(text).not.toContain(canary);
		expect(logError).toHaveBeenCalledExactlyOnceWith({
			err: error,
			route: "/foos/:fooId",
			status: 500,
		});
	});

	it("answers a thrown package error with its 4xx httpStatus and type, unlogged", async () => {
		const logError = vi
			.spyOn(logger, "error")
			.mockImplementation(() => undefined);
		const res = await appThrowing(new AuthnRequiredError(canary)).request(
			"/foos/foo_1",
		);

		expect(res.status).toBe(401);
		expect(res.headers.get("Content-Type")).toBe("application/problem+json");
		expect(await res.json()).toStrictEqual({
			code: "AuthnRequired",
			status: 401,
			title: "Unauthorized",
		});
		expect(logError).not.toHaveBeenCalled();
	});

	it.each([
		["a 5xx httpStatus", { httpStatus: 503, type: "Unavailable" }],
		["a 3xx httpStatus", { httpStatus: 399, type: "Redirect" }],
		["a string httpStatus", { httpStatus: "401", type: "AuthnRequired" }],
		["no type", { httpStatus: 401 }],
	])("treats an error with %s as a 500", async (_, fields) => {
		const error = Object.assign(new Error(canary), fields);
		const logError = vi
			.spyOn(logger, "error")
			.mockImplementation(() => undefined);
		const res = await appThrowing(error).request("/foos/foo_1");

		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({ code: "InternalError" });
		expect(logError).toHaveBeenCalledOnce();
	});
});

describe("httpNotFoundHandle", () => {
	it("answers an unknown path with a JSON 404 NotFound", async () => {
		const res = await appThrowing(new Error()).request("/nope");

		expect(res.status).toBe(404);
		expect(res.headers.get("Content-Type")).toBe("application/problem+json");
		expect(await res.json()).toStrictEqual({
			code: "NotFound",
			status: 404,
			title: "Not Found",
		});
	});
});

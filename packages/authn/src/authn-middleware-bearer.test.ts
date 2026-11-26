import { AsyncLocalStorage } from "node:async_hooks";
import { context, ROOT_CONTEXT, type Span, trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { authnMiddlewareCreate } from "./authn-middleware.ts";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestTokenForge } from "./authn-test-forge.ts";
import {
	authnTestMemoryOptions,
	authnTestOrigin,
} from "./authn-test-helpers.ts";
import type { Actor } from "./index.ts";
import { authnTestTokenCreate } from "./testing.ts";

const machine: Actor = {
	id: "foo-schedule",
	kind: "client",
	scopes: ["foo:read"],
};

const contextStorage = new AsyncLocalStorage<typeof ROOT_CONTEXT>();

// Lets `context.with` carry a span through awaits, as the HTTP instrumentation's manager does.
context.setGlobalContextManager({
	active: () => contextStorage.getStore() ?? ROOT_CONTEXT,
	bind: (_context, target) => target,
	disable() {
		return this;
	},
	enable() {
		return this;
	},
	with: (ctx, fn, thisArg, ...args) =>
		contextStorage.run(ctx, () => fn.call(thisArg, ...args)),
});

describe("authnMiddlewareCreate with the bearer token", () => {
	it("sets the actor from a memory-issuer token through actorFromClaims", async () => {
		const { app, authn } = await authnTestAppCreate();
		const token = await authnTestTokenCreate({ actor: machine, authn });
		const res = await app.request(`${authnTestOrigin}/api/v1/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual(machine);
	});

	it("puts only the actor's id on the request span as user.id", async () => {
		const attributes: [string, unknown][] = [];
		const span = {
			setAttribute: (key: string, value: unknown) => {
				attributes.push([key, value]);
			},
		} as unknown as Span;
		const { app, authn } = await authnTestAppCreate();
		const token = await authnTestTokenCreate({ actor: machine, authn });
		await context.with(trace.setSpan(context.active(), span), () =>
			app.request(`${authnTestOrigin}/api/v1/me`, {
				headers: { Authorization: `Bearer ${token}` },
			}),
		);

		expect(attributes).toStrictEqual([["user.id", "foo-schedule"]]);
	});

	it("answers 401 AuthnRequired when a route needs an actor and none is sent", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/api/v1/me`);

		expect(res.status).toBe(401);
		expect(await res.json()).toStrictEqual({
			code: "AuthnRequired",
			status: 401,
			title: "Unauthorized",
		});
	});

	it("leaves the actor undefined without a token and never rejects", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/api/v1/whoami`);

		expect(await res.json()).toStrictEqual({ actor: null });
	});

	it.each([
		["a forged token", "Bearer abc.def.ghi"],
		["a malformed header", "Bearer"],
		["another scheme", "Basic dXNlcjpwYXNz"],
	])("answers 401 AuthnInvalid for %s, never anonymous", async (_, header) => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
			headers: { Authorization: header },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ code: "AuthnInvalid" });
	});

	it("answers 401 AuthnInvalid for an expired token and never redirects", async () => {
		const { app } = await authnTestAppCreate();
		const token = await authnTestTokenForge({
			actor: machine,
			expiresInSeconds: -60,
		});
		const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(401);
		expect(res.headers.get("Location")).toBeNull();
	});

	it("answers 401 AuthnInvalid for a token from a memory issuer with another secret", async () => {
		const other = await authnTestAppCreate({
			...authnTestMemoryOptions,
			secret: Buffer.alloc(32, 9).toString("base64url"),
		});
		const token = await authnTestTokenCreate({
			actor: machine,
			authn: other.authn,
		});
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(401);
	});

	it("never accepts the cookie on the API", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/api/v1/me`, {
			headers: { Cookie: "__Host-authn=anything" },
		});

		expect(await res.json()).toMatchObject({ code: "AuthnRequired" });
	});
});

describe("authnMiddlewareCreate source", () => {
	it("refuses a source that is neither bearer nor cookie", async () => {
		const { authn } = await authnTestAppCreate();

		expect(() =>
			authnMiddlewareCreate(authn, { source: "header" as "bearer" }),
		).toThrow(
			'authnMiddlewareCreate: source must be "bearer" or "cookie", found "header"',
		);
	});
});

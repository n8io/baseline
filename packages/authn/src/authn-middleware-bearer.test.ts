import { AsyncLocalStorage } from "node:async_hooks";
import { context, ROOT_CONTEXT, type Span, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authnMiddlewareCreate } from "./authn-middleware.ts";
import { authnTestAppCreate } from "./authn-test-app.ts";
import {
	authnTestCookieForge,
	authnTestTokenForge,
} from "./authn-test-forge.ts";
import {
	authnTestMemoryOptions,
	authnTestOrigin,
} from "./authn-test-helpers.ts";
import { type Actor, authnCreate } from "./index.ts";
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

const dev: Actor = { id: "dev-user", kind: "user", scopes: [] };
const stale: Actor = { id: "stale", kind: "user", scopes: ["x"] };

// An app where something upstream already set the context variables, as another middleware might.
const appAfterUpstream = async (source: "bearer" | "cookie") => {
	const authn = await authnCreate(authnTestMemoryOptions);
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("actor", stale);
		c.set("authnExpiresAt", 1);
		await next();
	});
	app.use("*", authnMiddlewareCreate(authn, { source }));
	app.get("/auth", (c) =>
		c.json({
			actor: c.var.actor ?? null,
			expiresAt: c.var.authnExpiresAt ?? null,
		}),
	);
	app.get("/x", (c) =>
		c.json({
			actor: c.var.actor ?? null,
			expiresAt: c.var.authnExpiresAt ?? null,
		}),
	);
	return { app, authn };
};

describe("authnMiddlewareCreate context variables", () => {
	it.each(["bearer", "cookie"] as const)(
		"%s: leaves actor and authnExpiresAt unset when no token is sent",
		async (source) => {
			const { app } = await appAfterUpstream(source);
			const res = await app.request(`${authnTestOrigin}/x`);

			expect(await res.json()).toStrictEqual({ actor: null, expiresAt: null });
		},
	);

	it("cookie: leaves them unset on the auth routes' own paths", async () => {
		const { app } = await appAfterUpstream("cookie");
		const res = await app.request(`${authnTestOrigin}/auth`);

		expect(await res.json()).toStrictEqual({ actor: null, expiresAt: null });
	});
});

describe("authnMiddlewareCreate", () => {
	it("names itself when the authn did not come from authnCreate", () => {
		expect(() =>
			authnMiddlewareCreate({} as never, { source: "cookie" }),
		).toThrow("authnMiddlewareCreate: authn must come from authnCreate");
	});

	it("leaves /auth alone when the access cookie is not valid", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/auth`, {
			headers: { Cookie: "__Host-authn=garbage" },
		});

		expect(res.status).toBe(404);
	});

	it("still checks a path that only starts like /auth", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/authors`, {
			headers: { Cookie: "__Host-authn=garbage" },
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"/auth/sign-in?returnTo=%2Fauthors",
		);
	});
});

describe("authnMiddlewareCreate bearer header", () => {
	const get = async (header: string) => {
		const { app, authn } = await authnTestAppCreate();
		const token = await authnTestTokenCreate({ actor: dev, authn });
		return app.request(`${authnTestOrigin}/api/v1/whoami`, {
			headers: { Authorization: header.replace("TOKEN", token) },
		});
	};

	it("accepts Bearer in any letter case", async () => {
		expect((await get("bEaReR TOKEN")).status).toBe(200);
	});

	it("refuses text before the scheme", async () => {
		expect((await get("Basic Bearer TOKEN")).status).toBe(401);
	});

	it("refuses text after the token", async () => {
		expect((await get("Bearer TOKEN extra")).status).toBe(401);
	});
});

describe("authnMiddlewareCreate expiring cookie", () => {
	it.each(["GET", "HEAD"])("sends a %s to refresh first", async (method) => {
		const { app } = await authnTestAppCreate();
		const cookie = await authnTestCookieForge({
			actor: dev,
			expiresInSeconds: 5,
		});
		const res = await app.request(`${authnTestOrigin}/foos`, {
			headers: { Cookie: cookie },
			method,
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/auth/refresh?returnTo=%2Ffoos");
	});

	it("sends a POST to sign-in instead", async () => {
		const { app } = await authnTestAppCreate();
		const cookie = await authnTestCookieForge({
			actor: dev,
			expiresInSeconds: 5,
		});
		const res = await app.request(`${authnTestOrigin}/foos`, {
			headers: { Cookie: cookie },
			method: "POST",
		});

		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});
});

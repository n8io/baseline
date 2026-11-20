import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import {
	authnTestMemoryOptions,
	authnTestOrigin,
} from "./authn-test-helpers.ts";
import {
	type Actor,
	authnActorRequire,
	authnMiddlewareCreate,
} from "./index.ts";
import { authnTestBearerCreate } from "./testing.ts";

const admin: Actor = {
	id: "dev-admin",
	kind: "user",
	scopes: ["foo:delete", "foo:update"],
};

type App = Awaited<ReturnType<typeof authnTestAppCreate>>["app"];

const whoami = async (app: App, token: string) => {
	const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return { body: (await res.json()) as { actor: Actor | null }, res };
};

describe("authnTestBearerCreate", () => {
	it("gives a route test an Authn and a bearer token for any Actor", async () => {
		const { authn, tokenFor } = await authnTestBearerCreate({
			actorFromClaims: authnTestMemoryOptions.actorFromClaims,
		});
		const app = new Hono()
			.use("/api/*", authnMiddlewareCreate(authn, { source: "bearer" }))
			.get("/api/me", (c) => c.json(authnActorRequire(c)));
		const res = await app.request("/api/me", {
			headers: { authorization: `Bearer ${await tokenFor(admin)}` },
		});

		expect(await res.json()).toStrictEqual(admin);
	});

	it("makes its own secret, so its tokens fit no other Authn", async () => {
		const { tokenFor } = await authnTestBearerCreate({
			actorFromClaims: authnTestMemoryOptions.actorFromClaims,
		});
		const { app } = await authnTestAppCreate();

		expect((await whoami(app, await tokenFor(admin))).res.status).toBe(401);
	});
});

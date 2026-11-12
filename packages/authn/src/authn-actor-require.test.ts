import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type Actor, AuthnRequiredError, authnActorRequire } from "./index.ts";

const actor: Actor = { id: "user_1", kind: "user", scopes: [] };

describe("authnActorRequire", () => {
	it("returns the actor the middleware set", async () => {
		const app = new Hono();
		app.get("/", (c) => {
			c.set("actor", actor);
			return c.json(authnActorRequire(c));
		});

		expect(await (await app.request("/")).json()).toStrictEqual(actor);
	});

	it("throws AuthnRequiredError (401) without an actor", async () => {
		const app = new Hono();
		let thrown: unknown;
		app.get("/", (c) => c.json(authnActorRequire(c)));
		app.onError((error, c) => {
			thrown = error;
			return c.body(null, 500);
		});
		await app.request("/");

		expect(thrown).toBeInstanceOf(AuthnRequiredError);
		expect(thrown).toMatchObject({ httpStatus: 401, type: "AuthnRequired" });
	});
});

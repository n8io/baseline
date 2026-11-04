import { Hono } from "hono";
import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
	type Actor,
	AuthnRequiredError,
	actorContext,
	authnActorRequire,
} from "./index.ts";

const actor: Actor = { id: "user_1", kind: "user", scopes: [] };

const routerArgs = (value: Actor | undefined, url: string) => ({
	context: new RouterContextProvider(new Map([[actorContext, value]])),
	request: new Request(url),
});

describe("authnActorRequire in a Hono route", () => {
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

describe("authnActorRequire in a loader or action", () => {
	it("returns the actor from actorContext", () => {
		expect(
			authnActorRequire(routerArgs(actor, "https://app.test/foos")),
		).toStrictEqual(actor);
	});

	it("throws a document redirect to sign-in with this page as returnTo", () => {
		let thrown: unknown;
		try {
			authnActorRequire(
				routerArgs(undefined, "https://app.test/foos/foo_1?tab=2"),
			);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Response);
		const res = thrown as Response;
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"/auth/sign-in?returnTo=%2Ffoos%2Ffoo_1%3Ftab%3D2",
		);
		expect(res.headers.get("X-Remix-Reload-Document")).toBe("true");
	});
});

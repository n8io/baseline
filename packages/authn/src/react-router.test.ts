import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { Actor } from "./index.ts";
import { actorContext, authnPageActorRequire } from "./react-router.ts";

const actor: Actor = { id: "user_1", kind: "user", scopes: [] };

const routerArgs = (value: Actor | undefined, url: string) => ({
	context: new RouterContextProvider(new Map([[actorContext, value]])),
	request: new Request(url),
});

describe("authnPageActorRequire", () => {
	it("returns the actor from actorContext", () => {
		expect(
			authnPageActorRequire(routerArgs(actor, "https://app.test/foos")),
		).toStrictEqual(actor);
	});

	it("throws a document redirect to sign-in with this page as returnTo", () => {
		let thrown: unknown;
		try {
			authnPageActorRequire(
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

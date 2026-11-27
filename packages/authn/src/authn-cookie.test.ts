import { Hono } from "hono";
import { EncryptJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
	authnCookieGet,
	authnCookieKey,
	authnCookieNames,
	authnCookieOpen,
	authnCookieSet,
} from "./authn-cookie.ts";
import { authnSecretKeyDerive } from "./authn-secret-key.ts";
import { authnTestSecret } from "./authn-test-helpers.ts";

const key = authnCookieKey(authnTestSecret);

const appCreate = () => {
	const app = new Hono();
	app.get("/set-flow", async (c) => {
		await authnCookieSet({ c, key, name: "flow", value: "flow-value" });
		return c.body(null, 204);
	});
	app.get("/get/:name", async (c) =>
		c.json({
			value: await authnCookieGet({
				c,
				key,
				name: c.req.param("name") as keyof typeof authnCookieNames,
			}),
		}),
	);
	return app;
};

const sealedFlow = async (app: Hono): Promise<string> => {
	const line = (await app.request("/set-flow")).headers.getSetCookie()[0] ?? "";
	return line.slice(line.indexOf("=") + 1, line.indexOf(";"));
};

describe("authn cookies", () => {
	it("round-trips a value under its own name", async () => {
		const app = appCreate();
		const sealed = await sealedFlow(app);
		const res = await app.request("/get/flow", {
			headers: { Cookie: `${authnCookieNames.flow}=${sealed}` },
		});

		expect(await res.json()).toStrictEqual({ value: "flow-value" });
	});

	it("refuses a value sealed for another cookie name", async () => {
		const app = appCreate();
		const sealed = await sealedFlow(app);
		const res = await app.request("/get/refresh", {
			headers: { Cookie: `${authnCookieNames.refresh}=${sealed}` },
		});

		expect(await res.json()).toStrictEqual({ value: "invalid" });
	});
});

describe("authnCookieOpen", () => {
	const seal = ({
		audience,
		payload,
	}: {
		audience: string;
		payload: Record<string, unknown>;
	}) =>
		new EncryptJWT(payload)
			.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
			.setAudience(audience)
			.setExpirationTime("30d")
			.encrypt(key);

	it("opens a value sealed for its cookie name", async () => {
		const sealed = await seal({ audience: "access", payload: { v: "token" } });

		expect(await authnCookieOpen({ key, name: "access", sealed })).toBe(
			"token",
		);
	});

	it("answers invalid for a sealed value that is not a string", async () => {
		const sealed = await seal({ audience: "access", payload: { v: 5 } });

		expect(await authnCookieOpen({ key, name: "access", sealed })).toBe(
			"invalid",
		);
	});

	it("answers invalid for a value sealed for another cookie name", async () => {
		const sealed = await seal({ audience: "refresh", payload: { v: "token" } });

		expect(await authnCookieOpen({ key, name: "access", sealed })).toBe(
			"invalid",
		);
	});

	it("derives its key from the secret under the cookie info", () => {
		expect(authnCookieKey(authnTestSecret)).toStrictEqual(
			authnSecretKeyDerive({
				info: "baseline-authn cookie",
				secret: authnTestSecret,
			}),
		);
	});
});

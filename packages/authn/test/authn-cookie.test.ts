import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	authnCookieGet,
	authnCookieKey,
	authnCookieNames,
	authnCookieSet,
} from "../src/authn-cookie.ts";
import { secret } from "./helpers.ts";

const key = authnCookieKey(secret);

const appCreate = () => {
	const app = new Hono();
	app.get("/set-flow", async (c) => {
		await authnCookieSet(c, key, "flow", "flow-value");
		return c.body(null, 204);
	});
	app.get("/get/:name", async (c) =>
		c.json({
			value: await authnCookieGet(
				c,
				key,
				c.req.param("name") as keyof typeof authnCookieNames,
			),
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

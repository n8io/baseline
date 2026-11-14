import { authnMemoryTokenFetch } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { productionServerStart } from "./production-server.ts";

describe("the memory issuer in the production build", {
	timeout: 60_000,
}, () => {
	it("offers a sign-in button for every dev user", async () => {
		await using server = await productionServerStart({
			databaseUrl: "memory://",
		});

		const html = await (await fetch(`${server.url}/auth/sign-in`)).text();

		expect(html).toContain("Dev user");
		expect(html).toContain("Dev admin");
	});

	it("gives the dev client a token the API accepts", async () => {
		await using server = await productionServerStart({
			databaseUrl: "memory://",
		});

		const { authorization } = await authnMemoryTokenFetch({
			clientId: "dev-client",
			url: server.url,
		});
		const authorized = await fetch(`${server.url}/api/v1/unknown`, {
			headers: { authorization },
		});
		const anonymous = await fetch(`${server.url}/api/v1/unknown`);
		await authorized.body?.cancel();
		await anonymous.body?.cancel();

		// A token passes the Actor check and reaches the router, which has no such route.
		expect(authorized.status).toBe(404);
		expect(anonymous.status).toBe(401);
	});
});

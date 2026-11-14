import { authnMemoryTokenFetch } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { productionServerStart } from "./production-server.ts";

const fooNames = async (appEnv: string): Promise<string[]> => {
	await using server = await productionServerStart({
		databaseUrl: "memory://",
		env: { APP_ENV: appEnv },
	});
	const { authorization } = await authnMemoryTokenFetch({
		clientId: "dev-client",
		url: server.url,
	});
	const res = await fetch(`${server.url}/api/v1/foos`, {
		headers: { authorization },
	});
	const { items } = (await res.json()) as { items: { name: string }[] };
	return items.map((foo) => foo.name).sort();
};

describe("the Server's seeding", { timeout: 60_000 }, () => {
	it("seeds a memory database at every development start", async () => {
		expect(await fooNames("development")).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("never seeds in test", async () => {
		expect(await fooNames("test")).toEqual([]);
	});
});

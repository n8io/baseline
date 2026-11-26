import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featureFlagsClientConfigRead } from "../../src/ui/feature-flags-client-config.ts";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { integrationSignIn } from "./integration-sign-in.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

let server: ProductionServer;
let drop: () => Promise<void>;
let cookie: string;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	server = await productionServerStart({
		databaseUrl: database.databaseUrl,
		env: { LAUNCHDARKLY_CLIENT_SIDE_ID: "client-side-id-for-test" },
	});
	cookie = (await integrationSignIn(server.url)).cookie;
}, 30_000);

afterAll(async () => {
	await server?.stop();
	await drop?.();
});

const pageGet = async (headers: Record<string, string>) => {
	const res = await fetch(`${server.url}/`, { headers, redirect: "follow" });
	const html = await res.text();
	const window = new Window();
	window.document.documentElement.innerHTML = html;
	return { document: window.document, html, status: res.status };
};

// entry.client reads the config before React Router has built any state, so the page's HTML is the
// only place it can come from. This reads it the way entry.client does.
describe("the browser's feature flag config on the production build", {
	timeout: 30_000,
}, () => {
	it("is in the HTML a signed-in Actor receives", async () => {
		const page = await pageGet({ cookie });
		// The failure message then shows what the server sent.
		expect({
			html: page.html.slice(0, 800),
			status: page.status,
		}).toMatchObject({ status: 200 });
		expect(featureFlagsClientConfigRead(page.document)).toEqual({
			actorId: "dev-admin",
			clientSideId: "client-side-id-for-test",
		});
	});

	it("is not in the HTML without an Actor", async () => {
		expect(
			featureFlagsClientConfigRead((await pageGet({})).document),
		).toBeNull();
	});
});

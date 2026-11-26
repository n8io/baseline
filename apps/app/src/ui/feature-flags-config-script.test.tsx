// @vitest-environment happy-dom
import { renderToString } from "react-dom/server";
import {
	createStaticHandler,
	createStaticRouter,
	StaticRouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";
import { featureFlagsClientConfigRead } from "./feature-flags-client-config.ts";
import { FeatureFlagsConfigScript } from "./feature-flags-config-script.tsx";

// The page's HTML for a root route whose loader sends `featureFlags`, parsed as the browser does.
const pageRender = async (featureFlags: unknown): Promise<Document> => {
	const routes = [
		{
			Component: FeatureFlagsConfigScript,
			id: "root",
			loader: () => ({ featureFlags }),
			path: "/",
		},
	];
	const handler = createStaticHandler(routes);
	const context = await handler.query(new Request("http://localhost/"));
	if (context instanceof Response) {
		throw new Error("expected a render, got a redirect");
	}
	const html = renderToString(
		<StaticRouterProvider
			context={context}
			hydrate={false}
			router={createStaticRouter(routes, context)}
		/>,
	);
	document.head.innerHTML = html;
	return document;
};

describe("FeatureFlagsConfigScript", () => {
	it("renders the config where entry.client reads it", async () => {
		const config = { actorId: "a1", clientSideId: "c1" };
		expect(featureFlagsClientConfigRead(await pageRender(config))).toEqual(
			config,
		);
	});

	it("renders nothing without a config", async () => {
		expect(featureFlagsClientConfigRead(await pageRender(null))).toBeNull();
		expect(document.querySelector("script")).toBeNull();
	});

	it("cannot be closed early by a `<` in the config", async () => {
		const config = { actorId: "</script><b>x", clientSideId: "c1" };
		expect(featureFlagsClientConfigRead(await pageRender(config))).toEqual(
			config,
		);
		expect(document.querySelector("b")).toBeNull();
	});
});

import { describe, expect, it } from "vitest";
import {
	featureFlagsClientConfigGet,
	featureFlagsClientConfigRead,
} from "./feature-flags-client-config.ts";

const actor = { id: "a1", kind: "user", scopes: [] } as const;

describe("featureFlagsClientConfigGet", () => {
	it("holds the Actor's id and the client-side ID", () => {
		expect(featureFlagsClientConfigGet({ actor, clientSideId: "c1" })).toEqual({
			actorId: "a1",
			clientSideId: "c1",
		});
	});

	it.each([
		["no client-side ID", { actor, clientSideId: undefined }],
		["an empty client-side ID", { actor, clientSideId: "" }],
		["no Actor", { actor: undefined, clientSideId: "c1" }],
	])("is null with %s", (_name, input) => {
		expect(featureFlagsClientConfigGet(input)).toBeNull();
	});
});

describe("featureFlagsClientConfigRead", () => {
	it("reads the config from React Router's page data", () => {
		const config = { actorId: "a1", clientSideId: "c1" };
		expect(
			featureFlagsClientConfigRead({
				state: { loaderData: { root: { featureFlags: config } } },
			}),
		).toEqual(config);
	});

	it.each([
		["nothing", undefined],
		["a page without the config", { state: { loaderData: { root: {} } } }],
		[
			"a config of the wrong shape",
			{ state: { loaderData: { root: { featureFlags: { actorId: 1 } } } } },
		],
	])("is null for %s", (_name, routerContext) => {
		expect(featureFlagsClientConfigRead(routerContext)).toBeNull();
	});
});

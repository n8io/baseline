import { describe, expect, it } from "vitest";
import {
	type FeatureFlagsClientPage,
	featureFlagsClientConfigGet,
	featureFlagsClientConfigRead,
	featureFlagsClientConfigScriptId,
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

const pageWith = (textContent: string | null): FeatureFlagsClientPage => ({
	getElementById: (id) =>
		id === featureFlagsClientConfigScriptId && textContent !== null
			? { textContent }
			: null,
});

describe("featureFlagsClientConfigRead", () => {
	it("reads the config from the page's JSON block", () => {
		const config = { actorId: "a1", clientSideId: "c1" };
		expect(
			featureFlagsClientConfigRead(pageWith(JSON.stringify(config))),
		).toEqual(config);
	});

	it.each([
		["no block", null],
		["an empty block", ""],
		["text that is not JSON", "{"],
		["a config of the wrong shape", '{"actorId":1}'],
	])("is null for %s", (_name, textContent) => {
		expect(featureFlagsClientConfigRead(pageWith(textContent))).toBeNull();
	});
});

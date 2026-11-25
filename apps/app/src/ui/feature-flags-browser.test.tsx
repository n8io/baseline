import type { FeatureFlagsReadyStatus } from "@n8io/baseline-feature-flags";
import { featureFlagsMemoryClientCreate } from "@n8io/baseline-feature-flags/testing";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flagDefs, flagKinds } from "../flags.ts";
import { useFeatureFlag } from "./feature-flags.ts";
import {
	type AppFeatureFlagsClient,
	featureFlagsBrowserClientCreate,
	featureFlagsBrowserWrap,
} from "./feature-flags-browser.tsx";

const ExampleReader = () => <p>{String(useFeatureFlag("exampleFlag"))}</p>;

const clientCreate = ({
	exampleFlag = true,
	ready,
}: {
	exampleFlag?: boolean;
	ready?: Promise<FeatureFlagsReadyStatus>;
} = {}): AppFeatureFlagsClient => {
	const client = featureFlagsMemoryClientCreate({
		context: { actor: { id: "a1" } },
		flags: flagDefs,
		kinds: flagKinds,
		values: { exampleFlag },
	});
	return ready === undefined ? client : { ...client, ready };
};

describe("featureFlagsBrowserClientCreate", () => {
	it("makes no client without a config", () => {
		expect(featureFlagsBrowserClientCreate(null)).toBeNull();
	});
});

describe("featureFlagsBrowserWrap", () => {
	it("returns the app as it is without a client", async () => {
		const tree = <ExampleReader />;
		expect(await featureFlagsBrowserWrap({ client: null, tree })).toBe(tree);
	});

	it("waits for ready before it returns the app", async () => {
		const deferred = Promise.withResolvers<"connected">();
		let wrapped = false;
		const result = featureFlagsBrowserWrap({
			client: clientCreate({ ready: deferred.promise }),
			tree: <ExampleReader />,
		}).then((tree) => {
			wrapped = true;
			return tree;
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(wrapped).toBe(false);
		deferred.resolve("connected");
		await result;
		expect(wrapped).toBe(true);
	});

	it.each(["failed", "timeout"] as const)(
		"still returns the app when the flags settle %s",
		async (status) => {
			const tree = await featureFlagsBrowserWrap({
				client: clientCreate({ ready: Promise.resolve(status) }),
				tree: <ExampleReader />,
			});
			expect(renderToString(tree)).toBe("<p>false</p>");
		},
	);

	// React hydrates with each hook's server snapshot, so a live value that differs from the
	// fallback must not change the markup the first client render produces.
	it("renders the markup the server rendered, even when the live value differs", async () => {
		const serverHtml = renderToString(<ExampleReader />);
		const client = clientCreate({ exampleFlag: true });
		await client.ready;
		expect(client.flags.get("exampleFlag")).toBe(true);
		const tree = await featureFlagsBrowserWrap({
			client,
			tree: <ExampleReader />,
		});
		expect(serverHtml).toBe("<p>false</p>");
		expect(renderToString(tree)).toBe(serverHtml);
	});
});

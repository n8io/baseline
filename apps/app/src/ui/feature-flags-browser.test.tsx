import type { FeatureFlagsReadyStatus } from "@n8io/baseline-feature-flags";
import { featureFlagsMemoryClientCreate } from "@n8io/baseline-feature-flags/testing";
import { Window } from "happy-dom";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flagDefs, flagKinds } from "../flags.ts";
import { useFeatureFlag } from "./feature-flags.ts";
import {
	type AppFeatureFlagsClient,
	featureFlagsBrowserClientCreate,
	featureFlagsBrowserStart,
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

describe("featureFlagsBrowserStart", () => {
	const pageCreate = ({
		config,
		routerState,
	}: {
		config?: string;
		routerState?: boolean;
	}) => {
		const window = new Window();
		window.document.head.innerHTML =
			config === undefined
				? ""
				: `<script type="application/json" id="feature-flags-config">${config}</script>`;
		// What React Router leaves on the window once it has built its state, which entry.client
		// must not read: it is empty when entry.client runs.
		if (routerState) {
			Reflect.set(window, "__reactRouterContext", {
				state: {
					loaderData: {
						root: { featureFlags: { actorId: "a1", clientSideId: "csid" } },
					},
				},
			});
		}
		return window.document;
	};

	const spyCreate = () => {
		const configs: unknown[] = [];
		return {
			configs,
			create: (
				config: Parameters<typeof featureFlagsBrowserClientCreate>[0],
			) => {
				configs.push(config);
				return config === null ? null : clientCreate();
			},
		};
	};

	it("opens the client the page's config script asks for", async () => {
		const { configs, create } = spyCreate();
		const tree = await featureFlagsBrowserStart({
			create,
			page: pageCreate({
				config: JSON.stringify({ actorId: "a1", clientSideId: "csid" }),
			}),
			tree: <ExampleReader />,
		});
		expect(configs).toEqual([{ actorId: "a1", clientSideId: "csid" }]);
		expect(renderToString(tree)).toBe("<p>false</p>");
	});

	it("makes no client and returns the app as it is without a config script", async () => {
		const { configs, create } = spyCreate();
		const tree = <ExampleReader />;
		expect(
			await featureFlagsBrowserStart({ create, page: pageCreate({}), tree }),
		).toBe(tree);
		expect(configs).toEqual([null]);
	});

	// The T10 bug: the config sat in React Router's state, which does not exist when entry.client
	// runs. Only the page's script counts, so state without a script makes no client.
	it("ignores React Router's state when the page has no config script", async () => {
		const { configs, create } = spyCreate();
		const tree = <ExampleReader />;
		expect(
			await featureFlagsBrowserStart({
				create,
				page: pageCreate({ routerState: true }),
				tree,
			}),
		).toBe(tree);
		expect(configs).toEqual([null]);
	});

	it("makes no client from a malformed config script", async () => {
		const { configs, create } = spyCreate();
		await featureFlagsBrowserStart({
			create,
			page: pageCreate({ config: "{nope" }),
			tree: <ExampleReader />,
		});
		expect(configs).toEqual([null]);
	});
});

// entry.client is a top-level-await module no test can import, so read what it calls: it must hand
// `featureFlagsBrowserStart` the page's own `document`, not React Router's state (A35 also bans that).
describe("entry.client", () => {
	it("starts the feature flags from the page's document", () => {
		const files = import.meta.glob(["./entry.client.tsx"], {
			eager: true,
			import: "default",
			query: "?raw",
		});
		const source = String(files["./entry.client.tsx"]);
		expect(source).toMatch(/featureFlagsBrowserStart\(\{\s*page: document,/);
		expect(source).not.toContain("__reactRouterContext");
	});
});

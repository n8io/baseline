// @vitest-environment happy-dom
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
	afterEach,
	beforeAll,
	describe,
	expect,
	expectTypeOf,
	it,
} from "vitest";
import { featureFlagsMemoryClientCreate } from "../core/feature-flags-memory-client.ts";
import type { FeatureFlagMemoryValues } from "../core/feature-flags-memory-source.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "../core/feature-flags-test-fixtures.ts";
import { featureFlagsReactCreate } from "./feature-flags-react-create.ts";

const { FeatureFlagsProvider, useFeatureFlag } =
	featureFlagsReactCreate(featureFlagsTestDefs);

beforeAll(() => {
	// boundary: React reads this global to know that act() wraps the test's renders
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: { unmount(): void }[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
});

// Biome cannot see that act's result is awaitable, so tests await this.
const actRun = async (run: () => Promise<unknown>): Promise<void> => {
	await Promise.resolve(act(run));
};

const render = async (element: ReactElement): Promise<HTMLElement> => {
	const container = document.createElement("div");
	const root = createRoot(container);
	roots.push(root);
	await actRun(async () => root.render(element));
	return container;
};

const clientCreate = (
	values: FeatureFlagMemoryValues<typeof featureFlagsTestDefs> | null = null,
) =>
	featureFlagsMemoryClientCreate({
		context: { actor: { id: "a1" } },
		flags: featureFlagsTestDefs,
		kinds: featureFlagsTestKinds,
		values,
	});

type Counted = { readonly onRender?: () => void };

const Hero = ({ onRender }: Counted): ReactElement => {
	onRender?.();
	return createElement("p", { id: "hero" }, useFeatureFlag("heroCopy"));
};

const Limit = ({ onRender }: Counted): ReactElement => {
	onRender?.();
	return createElement(
		"p",
		{ id: "limit" },
		String(useFeatureFlag("itemLimit")),
	);
};

const Mounted = ({
	onMount,
}: {
	readonly onMount: () => void;
}): ReactElement => {
	useEffect(onMount, [onMount]);
	return createElement(Hero, {});
};

const Theme = ({
	onValue,
}: {
	readonly onValue: (value: unknown) => void;
}): ReactElement => {
	const theme = useFeatureFlag("theme");
	onValue(theme);
	return createElement("p", null, theme.mode);
};

const Checkout = (): ReactElement =>
	createElement("p", null, String(useFeatureFlag("checkoutRedesign")));

const Both = (): ReactElement =>
	createElement(
		"p",
		null,
		`${useFeatureFlag("heroCopy")}:${useFeatureFlag("itemLimit")}`,
	);

describe("useFeatureFlag", () => {
	it("re-renders on a change, and only the readers of the changed flag", async () => {
		const client = clientCreate({ heroCopy: "plain", itemLimit: 10 });
		await client.ready;
		const renders = { hero: 0, limit: 0 };
		const container = await render(
			createElement(
				FeatureFlagsProvider,
				{ flags: client.flags, ready: client.ready },
				createElement(Hero, {
					onRender: () => {
						renders.hero += 1;
					},
				}),
				createElement(Limit, {
					onRender: () => {
						renders.limit += 1;
					},
				}),
			),
		);
		expect(container.querySelector("#hero")?.textContent).toBe("plain");
		const before = { ...renders };
		await actRun(async () =>
			client.valuesSet({ heroCopy: "bold", itemLimit: 10 }),
		);
		expect(container.querySelector("#hero")?.textContent).toBe("bold");
		expect(renders.hero).toBe(before.hero + 1);
		expect(renders.limit).toBe(before.limit);
	});

	it("keeps an object flag's reference, so a render does not loop", async () => {
		const client = clientCreate({ theme: { mode: "dark" } });
		await client.ready;
		const seen = new Set<unknown>();
		await render(
			createElement(
				FeatureFlagsProvider,
				{ flags: client.flags },
				createElement(Theme, { onValue: (value) => seen.add(value) }),
			),
		);
		await actRun(async () => client.valuesSet({ theme: { mode: "dark" } }));
		expect(seen.size).toBe(1);
	});

	it("follows a context replacement", async () => {
		const client = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: (context) => ({ checkoutRedesign: context.actor.id === "b2" }),
		});
		await client.ready;
		const container = await render(
			createElement(
				FeatureFlagsProvider,
				{ flags: client.flags },
				createElement(Checkout),
			),
		);
		expect(container.textContent).toBe("false");
		await actRun(async () => client.contextSet({ actor: { id: "b2" } }));
		expect(container.textContent).toBe("true");
	});

	it("returns the declared fallback outside a Provider", async () => {
		const container = await render(createElement(Hero, {}));
		expect(container.textContent).toBe("plain");
	});

	it("types the value from the declaration and rejects unknown names", () => {
		const check = (): void => {
			expectTypeOf(useFeatureFlag("checkoutRedesign")).toEqualTypeOf<boolean>();
			expectTypeOf(useFeatureFlag("itemLimit")).toEqualTypeOf<number>();
			expectTypeOf(useFeatureFlag("heroCopy")).toEqualTypeOf<
				"plain" | "bold"
			>();
			expectTypeOf(useFeatureFlag("theme")).toEqualTypeOf<{
				readonly mode: "dark" | "light";
			}>();
			// @ts-expect-error unknown flag names do not compile
			useFeatureFlag("nope");
		};
		expect(check).toBeTypeOf("function");
	});
});

describe("FeatureFlagsProvider", () => {
	it("shows the fallback until ready settles, then the children", async () => {
		const client = clientCreate({ heroCopy: "bold" });
		const pending = Promise.withResolvers<"connected">();
		const container = await render(
			createElement(
				FeatureFlagsProvider,
				{ fallback: "loading", flags: client.flags, ready: pending.promise },
				"children",
			),
		);
		expect(container.textContent).toBe("loading");
		await actRun(async () => pending.resolve("connected"));
		expect(container.textContent).toBe("children");
	});

	it("does not wait forever on a ready that rejects", async () => {
		const client = clientCreate();
		const rejected = Promise.withResolvers<"connected">();
		const container = await render(
			createElement(
				FeatureFlagsProvider,
				{ fallback: "loading", flags: client.flags, ready: rejected.promise },
				"children",
			),
		);
		expect(container.textContent).toBe("loading");
		await actRun(async () =>
			rejected.reject(new Error("a ready that rejects still settles")),
		);
		expect(container.textContent).toBe("children");
	});

	it("renders children once a failed service settles, reading the fallbacks", async () => {
		const client = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			ready: "failed",
			values: { heroCopy: "bold" },
		});
		const container = await render(
			createElement(
				FeatureFlagsProvider,
				{ fallback: "loading", flags: client.flags, ready: client.ready },
				createElement(Hero, {}),
			),
		);
		expect(container.textContent).toBe("plain");
	});

	it("renders the children at once without ready", async () => {
		const client = clientCreate();
		const container = await render(
			createElement(FeatureFlagsProvider, { flags: client.flags }, "now"),
		);
		expect(container.textContent).toBe("now");
	});
});

describe("hydration", () => {
	it("keeps the children mounted when ready is a status the page already awaited", async () => {
		const client = clientCreate({ heroCopy: "bold" });
		const status = await client.ready;
		const mounts = { count: 0 };
		const element = createElement(
			FeatureFlagsProvider,
			{ fallback: "loading", flags: client.flags, ready: status },
			createElement(Mounted, {
				onMount: () => {
					mounts.count += 1;
				},
			}),
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(element);
		await actRun(async () => {
			roots.push(hydrateRoot(container, element));
		});
		expect(container.textContent).toBe("bold");
		expect(mounts.count).toBe(1);
	});
});

describe("server rendering", () => {
	it("renders children with the declared fallbacks, whatever the client holds", async () => {
		const client = clientCreate({ heroCopy: "bold", itemLimit: 99 });
		await client.ready;
		const html = renderToString(
			createElement(
				FeatureFlagsProvider,
				{
					fallback: "loading",
					flags: client.flags,
					ready: new Promise<"connected">(() => undefined),
				},
				createElement(Both),
			),
		);
		expect(html).toContain("plain:10");
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetReloadListen } from "./asset-reload-listen.ts";

// The unit project has no DOM: these stand in for the three browser things the function touches.
class HTMLLinkElement {
	href = "";
}
class HTMLScriptElement {
	src = "";
	type = "";
}
const link = (href: string) => Object.assign(new HTMLLinkElement(), { href });
const script = (fields: { src?: string; type?: string }) =>
	Object.assign(new HTMLScriptElement(), fields);

const origin = "https://app.example";
let failed: (event: { target: unknown }) => void;
let reload: ReturnType<typeof vi.fn<() => void>>;
let stored: Map<string, string>;
const pageLoad = () => vi.stubGlobal("performance", { timeOrigin: Date.now() });

beforeEach(() => {
	vi.useFakeTimers({ now: new Date("2026-11-13T12:00:00Z"), toFake: ["Date"] });
	reload = vi.fn<() => void>();
	stored = new Map();
	// Each page load starts its own clock; `pageLoad` stands in for the reloaded page.
	pageLoad();
	vi.stubGlobal("HTMLLinkElement", HTMLLinkElement);
	vi.stubGlobal("HTMLScriptElement", HTMLScriptElement);
	vi.stubGlobal("sessionStorage", {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
	});
	vi.stubGlobal("window", {
		addEventListener: (
			...[type, listener, capture]: [string, typeof failed, boolean]
		) => {
			// Load errors do not bubble: without capture the listener would never hear one.
			expect([type, capture]).toEqual(["error", true]);
			failed = listener;
		},
		location: { origin, reload },
	});
	assetReloadListen();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("assetReloadListen", () => {
	it.each([
		["stylesheet", link(`${origin}/assets/app-aUG88TLR.css`)],
		["script", script({ src: `${origin}/assets/entry.client-SVWlXy5I.js` })],
		["inline module script whose import failed", script({ type: "module" })],
	])(
		"reloads the page when one of the build's own files fails to load: %s",
		(_, target) => {
			failed({ target });

			expect(reload).toHaveBeenCalledTimes(1);
		},
	);

	it.each([
		[
			"a script from another origin",
			script({ src: "https://cdn.example/a.js" }),
		],
		["a file outside /assets/", link(`${origin}/favicon.ico`)],
		["an inline classic script", script({})],
		["an image", { src: `${origin}/assets/logo-aUG88TLR.png` }],
		["a script that threw (the event's target is window)", undefined],
	])("leaves the page alone for %s", (_, target) => {
		failed({ target });

		expect(reload).not.toHaveBeenCalled();
	});

	it("reloads once: the reloaded page stays as it is, however late its files fail", () => {
		const target = link(`${origin}/assets/app-aUG88TLR.css`);
		failed({ target });
		vi.advanceTimersByTime(9_999);
		pageLoad();
		failed({ target: script({ type: "module" }) });
		vi.advanceTimersByTime(60_000);
		failed({ target });

		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("reloads again on a page loaded more than ten seconds later, e.g. the next deploy", () => {
		const target = link(`${origin}/assets/app-aUG88TLR.css`);
		failed({ target });
		vi.advanceTimersByTime(10_000);
		pageLoad();
		failed({ target });

		expect(reload).toHaveBeenCalledTimes(2);
	});

	it("never reloads when session storage is blocked, because it could not stop at one", () => {
		vi.stubGlobal("sessionStorage", {
			getItem: () => {
				throw new Error("SecurityError");
			},
		});
		failed({ target: link(`${origin}/assets/app-aUG88TLR.css`) });

		expect(reload).not.toHaveBeenCalled();
	});

	it("uses nothing from outside its own body, so its source runs inline in the page", () => {
		const page = {
			HTMLLinkElement,
			HTMLScriptElement,
			performance: { timeOrigin: Date.now() },
			sessionStorage: { getItem: () => null, setItem: () => undefined },
			window: {
				addEventListener: (_: string, listener: typeof failed) => {
					failed = listener;
				},
				location: { origin, reload },
			},
		};
		new Function(...Object.keys(page), `(${assetReloadListen})()`)(
			...Object.values(page),
		);
		failed({ target: link(`${origin}/assets/app-aUG88TLR.css`) });

		expect(reload).toHaveBeenCalledTimes(1);
	});
});

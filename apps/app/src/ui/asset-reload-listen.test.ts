import { describe, expect, it } from "vitest";
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
const css = `${origin}/assets/app-aUG88TLR.css`;

type Failed = (event: { target: unknown }) => void;

// Runs the function's source against a hand-built page, so nothing global is stubbed. A parameter
// named Date shadows the global inside the body, and `pageLoad` stands in for the reloaded page:
// each page load starts its own clock at the current time.
const pageCreate = ({
	sessionStorage,
	stored = new Map<string, string>(),
}: {
	sessionStorage?: unknown;
	stored?: Map<string, string>;
} = {}) => {
	let clock = Date.parse("2026-11-13T12:00:00Z");
	let reloads = 0;
	let failed: Failed | undefined;
	const page = {
		Date: { now: () => clock },
		HTMLLinkElement,
		HTMLScriptElement,
		performance: { timeOrigin: clock },
		sessionStorage: sessionStorage ?? {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value),
		},
		window: {
			addEventListener: (
				...[type, listener, capture]: [string, Failed, boolean]
			) => {
				// Load errors do not bubble: without capture the listener would never hear one.
				expect([type, capture]).toEqual(["error", true]);
				failed = listener;
			},
			location: {
				origin,
				reload: () => {
					reloads += 1;
				},
			},
		},
	};
	new Function(...Object.keys(page), `(${assetReloadListen})()`)(
		...Object.values(page),
	);
	return {
		advance: (ms: number) => {
			clock += ms;
		},
		failed: (target: unknown) => failed?.({ target }),
		load: () => {
			page.performance.timeOrigin = clock;
		},
		reloads: () => reloads,
	};
};

describe("assetReloadListen", () => {
	it.each([
		["stylesheet", link(css)],
		["script", script({ src: `${origin}/assets/entry.client-SVWlXy5I.js` })],
		["inline module script whose import failed", script({ type: "module" })],
	])(
		"reloads the page when one of the build's own files fails to load: %s",
		(_, target) => {
			const page = pageCreate();
			page.failed(target);

			expect(page.reloads()).toBe(1);
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
		const page = pageCreate();
		page.failed(target);

		expect(page.reloads()).toBe(0);
	});

	it("reloads once: the reloaded page stays as it is, however late its files fail", () => {
		const page = pageCreate();
		const target = link(css);
		page.failed(target);
		page.advance(9_999);
		page.load();
		page.failed(script({ type: "module" }));
		page.advance(60_000);
		page.failed(target);

		expect(page.reloads()).toBe(1);
	});

	it("reloads again on a page loaded more than ten seconds later, e.g. the next deploy", () => {
		const page = pageCreate();
		const target = link(css);
		page.failed(target);
		page.advance(10_000);
		page.load();
		page.failed(target);

		expect(page.reloads()).toBe(2);
	});

	it("never reloads when session storage is blocked, because it could not stop at one", () => {
		const page = pageCreate({
			sessionStorage: {
				getItem: () => {
					throw new Error("SecurityError");
				},
			},
		});
		page.failed(link(css));

		expect(page.reloads()).toBe(0);
	});

	it("uses nothing from outside its own body, so its source runs inline in the page", () => {
		const page = pageCreate();
		page.failed(link(css));

		expect(page.reloads()).toBe(1);
	});
});

import { describe, expect, it } from "vitest";
import {
	authnSignInPageFailed,
	authnSignInPageMemoryForm,
} from "./authn-sign-in-page.ts";

describe("authnSignInPageMemoryForm", () => {
	it("titles the page and lists one posting form per user, in order", () => {
		const html = authnSignInPageMemoryForm({
			returnTo: "/foos",
			users: [
				{ id: "a", name: "Ann", scopes: ["foo:read", "foo:update"] },
				{ id: "b", name: "Bo", scopes: [] },
			],
		});

		expect(html).toContain("<title>Sign in (local)</title>");
		expect(html).toContain("<h1>Sign in</h1>");
		expect(
			html.match(/<form method="post" action="\/auth\/sign-in">/g),
		).toHaveLength(2);
		expect(html).toContain('name="who" value="a"');
		expect(html).toContain('name="returnTo" value="/foos"');
		expect(html).toContain("<small>foo:read foo:update</small>");
		expect(html).toContain("<small>no scopes</small>");
		expect(html.indexOf("Ann")).toBeLessThan(html.indexOf("Bo"));
		expect(html).toContain("</form><form");
		expect(html).not.toContain("Stryker");
	});

	it("escapes ampersands, quotes and angle brackets in every field", () => {
		const html = authnSignInPageMemoryForm({
			returnTo: '/a?x=1&y="2"',
			users: [{ id: 'i"<>&', name: "<b>&Bo</b>", scopes: ["s&<>"] }],
		});

		expect(html).toContain('value="i&quot;&lt;&gt;&amp;"');
		expect(html).toContain('value="/a?x=1&amp;y=&quot;2&quot;"');
		expect(html).toContain("&lt;b&gt;&amp;Bo&lt;/b&gt;");
		expect(html).toContain("<small>s&amp;&lt;&gt;</small>");
		expect(html).not.toContain("<b>");
	});
});

describe("authnSignInPageFailed", () => {
	it("titles the page and links back to sign-in with the encoded returnTo", () => {
		const html = authnSignInPageFailed("/foos?a=1&b=2");

		expect(html).toContain("<title>Sign-in failed</title>");
		expect(html).toContain("<h1>Sign-in failed</h1>");
		expect(html).toContain(
			'<a href="/auth/sign-in?returnTo=%2Ffoos%3Fa%3D1%26b%3D2">Try again</a>',
		);
	});
});

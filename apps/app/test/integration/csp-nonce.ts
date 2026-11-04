import { expect } from "vitest";

/** The response's CSP nonce, after checking that every <script> tag in `html` carries it. */
export const scriptsNonce = (res: Response, html: string): string => {
	const csp = res.headers.get("content-security-policy") ?? "";
	expect(csp).toMatch(
		/^base-uri 'self'; default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-/,
	);
	const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
	const scripts = html.match(/<script\b[^>]*>/g) ?? [];
	expect(scripts.length).toBeGreaterThan(0);
	for (const script of scripts) {
		expect(script).toContain(` nonce="${nonce}"`);
	}
	return nonce;
};

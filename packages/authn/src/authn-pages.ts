const escapeHtml = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const page = (title: string, body: string): string =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:24rem;margin:3rem auto;padding:0 1rem">${body}</body></html>`;

const devButton = (
	who: "admin" | "user",
	label: string,
	returnTo: string,
): string =>
	`<form method="post" action="/auth/sign-in"><input type="hidden" name="who" value="${who}"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"><button type="submit" style="width:100%;padding:.75rem;margin:.25rem 0">${label}</button></form>`;

/** The memory issuer's sign-in page: pick "Dev user" (no scopes) or "Dev admin". */
export const authnMemorySignInPage = (returnTo: string): string =>
	page(
		"Sign in (local)",
		`<h1>Sign in</h1><p>Local issuer: no password, development and test only.</p>${devButton("user", "Dev user", returnTo)}${devButton("admin", "Dev admin", returnTo)}`,
	);

/** Shown when the provider refuses or the sign-in flow cannot be checked; never echoes the reason. */
export const authnSignInFailedPage = (returnTo: string): string =>
	page(
		"Sign-in failed",
		`<h1>Sign-in failed</h1><p><a href="/auth/sign-in?returnTo=${escapeHtml(encodeURIComponent(returnTo))}">Try again</a></p>`,
	);

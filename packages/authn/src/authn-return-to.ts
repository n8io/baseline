// Browsers drop tabs and newlines from URLs and read `\` as `/`, so `/\t/evil.example` would
// become `//evil.example`. A safe path starts with one `/` and holds neither.
const authnSamePathIs = (returnTo: string): boolean =>
	returnTo.startsWith("/") &&
	!returnTo.startsWith("//") &&
	![...returnTo].some((char) => char === "\\" || char.charCodeAt(0) < 0x20);

/** Keeps only same-origin paths, so `returnTo` can never send a user to another site. */
export const authnReturnToSafe = (returnTo: string | undefined): string =>
	returnTo !== undefined && authnSamePathIs(returnTo) ? returnTo : "/";

// Hands each domain's use cases to loaders and actions. Type-only imports from domains.
import {
	actorContext,
	authnExpiryContext,
} from "@n8io/baseline-authn/react-router";
import type { Context } from "hono";
import {
	createContext,
	type RouterContext,
	RouterContextProvider,
} from "react-router";
import type { FooUseCases } from "#domains/foo/index.ts";
import type { DomainsUseCases } from "../use-cases.ts";

// The request's CSP nonce, for every inline script the server renders.
export const cspNonceContext: RouterContext<string | undefined> = createContext<
	string | undefined
>();
export const fooUseCasesContext: RouterContext<FooUseCases> =
	createContext<FooUseCases>();
// domain-create: context-keys

export const uiLoadContextCreate = (
	c: Context,
	// domain-create: domains-start
	useCases: DomainsUseCases,
	// domain-create: domains-end
): RouterContextProvider =>
	new RouterContextProvider(
		new Map<RouterContext<unknown>, unknown>([
			[actorContext, c.var.actor],
			[authnExpiryContext, c.var.authnExpiresAt],
			[cspNonceContext, c.var.secureHeadersNonce],
			[fooUseCasesContext, useCases.fooUseCases],
			// domain-create: context
		]),
	);

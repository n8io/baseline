// Hands each context's Use cases to loaders and actions. Type-only imports from contexts.
import {
	actorContext,
	authnExpiresAtContext,
} from "@n8io/baseline-authn/react-router";
import type { Context } from "hono";
import {
	createContext,
	type RouterContext,
	RouterContextProvider,
} from "react-router";
import type { FooUseCases } from "#contexts/foo/index.ts";
import type { Contexts } from "../contexts.ts";

// The request's CSP nonce, for every inline script the server renders.
export const cspNonceContext: RouterContext<string | undefined> = createContext<
	string | undefined
>();
export const fooUseCasesContext: RouterContext<FooUseCases> =
	createContext<FooUseCases>();
// wiring: context-keys

export const uiLoadContextCreate = (
	c: Context,
	// wiring: contexts-start
	contexts: Contexts,
	// wiring: contexts-end
): RouterContextProvider =>
	new RouterContextProvider(
		new Map<RouterContext<unknown>, unknown>([
			[actorContext, c.var.actor],
			[authnExpiresAtContext, c.var.authnExpiresAt],
			[cspNonceContext, c.var.secureHeadersNonce],
			[fooUseCasesContext, contexts.fooContext.useCases],
			// wiring: context
		]),
	);

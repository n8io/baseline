// Hands each domain's use cases to loaders and actions. Type-only imports from domains.
import { actorContext, authnExpiryContext } from "@n8io/baseline-authn";
import type { Context } from "hono";
import {
	createContext,
	type RouterContext,
	RouterContextProvider,
} from "react-router";
import type { FooUseCases } from "#domains/foo/index.ts";

export const fooUseCasesContext: RouterContext<FooUseCases> =
	createContext<FooUseCases>();
// domain-create: context-keys

export const loadContextCreate = (
	c: Context,
	useCases: {
		fooUseCases: FooUseCases;
		// domain-create: context-types
	},
): RouterContextProvider =>
	new RouterContextProvider(
		new Map<RouterContext<unknown>, unknown>([
			[actorContext, c.var.actor],
			[authnExpiryContext, c.var.authnExpiresAt],
			[fooUseCasesContext, useCases.fooUseCases],
			// domain-create: context
		]),
	);

// Hands each domain's use cases to loaders and actions. Type-only imports from domains.
import { actorContext, authnExpiryContext } from "@n8io/baseline-authn";
import type { Context } from "hono";
import { type RouterContext, RouterContextProvider } from "react-router";

// domain-create: context-keys

export const loadContextCreate = (
	c: Context,
	// domain-create: context-types
	_useCases: Record<string, never>,
): RouterContextProvider =>
	new RouterContextProvider(
		new Map<RouterContext<unknown>, unknown>([
			[actorContext, c.var.actor],
			[authnExpiryContext, c.var.authnExpiresAt],
			// domain-create: context
		]),
	);

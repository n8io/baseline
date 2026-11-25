// Hydrates the app. It differs from React Router's default only by the feature flags wrapped around
// it, so `pnpm piece-remove feature-flags` deletes this file and the default takes over.
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import {
	featureFlagsBrowserClientCreate,
	featureFlagsBrowserWrap,
} from "./feature-flags-browser.tsx";
import { featureFlagsClientConfigRead } from "./feature-flags-client-config.ts";

const tree = await featureFlagsBrowserWrap({
	client: featureFlagsBrowserClientCreate(
		featureFlagsClientConfigRead(Reflect.get(window, "__reactRouterContext")),
	),
	tree: <HydratedRouter />,
});

startTransition(() => {
	hydrateRoot(document, <StrictMode>{tree}</StrictMode>);
});

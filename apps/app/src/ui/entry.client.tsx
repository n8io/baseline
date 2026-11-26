// Hydrates the app. It differs from React Router's default only by the feature flags wrapped around
// it, so `pnpm piece-remove feature-flags` deletes this file and the default takes over.
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { featureFlagsBrowserStart } from "./feature-flags-browser.tsx";

// The client keeps the Actor the page loaded with: signing in or out is a full page load through
// the server, so the page's Actor never changes under it.
const tree = await featureFlagsBrowserStart({
	page: document,
	tree: <HydratedRouter />,
});

startTransition(() => {
	hydrateRoot(document, <StrictMode>{tree}</StrictMode>);
});

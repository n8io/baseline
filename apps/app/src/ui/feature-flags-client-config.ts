// What the browser needs to open its feature flags: the public client-side ID and the Actor's id.
// The root loader sends it with the page, the head carries it as JSON, and entry.client reads it
// before hydrating.
// `pnpm piece-remove feature-flags` deletes this file.
import type { Actor } from "@n8io/baseline-authn";
import { createContext, type RouterContext } from "react-router";
import { z } from "zod";

// The client-side ID, in the load context: server.ts sets it from LAUNCHDARKLY_CLIENT_SIDE_ID.
export const featureFlagsClientSideIdContext: RouterContext<string | null> =
	createContext<string | null>(null);

export const featureFlagsClientConfigSchema = z
	.object({ actorId: z.string(), clientSideId: z.string() })
	.nullable();

export type FeatureFlagsClientConfig = z.infer<
	typeof featureFlagsClientConfigSchema
>;

// Null when there is no client-side ID or no signed-in Actor: the browser then reads every flag as
// its declared fallback and makes no request.
export const featureFlagsClientConfigGet = ({
	actor,
	clientSideId,
}: {
	actor: Actor | null | undefined;
	clientSideId: string | null | undefined;
}): FeatureFlagsClientConfig =>
	actor && clientSideId ? { actorId: actor.id, clientSideId } : null;

// The id of the JSON `<script>` the server renders into the page's head (FeatureFlagsConfigScript).
export const featureFlagsClientConfigScriptId = "feature-flags-config";

// What the read needs of a document: the browser's `document` fits.
export type FeatureFlagsClientPage = {
	getElementById: (id: string) => { textContent: string | null } | null;
};

// The config the server put in the page's HTML, which exists before React Router builds any state.
// Anything missing or malformed is null.
export const featureFlagsClientConfigRead = (
	page: FeatureFlagsClientPage,
): FeatureFlagsClientConfig => {
	const text = page.getElementById(
		featureFlagsClientConfigScriptId,
	)?.textContent;
	if (!text) {
		return null;
	}
	try {
		return featureFlagsClientConfigSchema.parse(JSON.parse(text));
	} catch {
		return null;
	}
};

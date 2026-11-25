// Opens the browser's feature flags and wraps the app in their Provider. entry.client hydrates what
// this returns. `pnpm piece-remove feature-flags` deletes this file.
import type { FeatureFlagsClient } from "@n8io/baseline-feature-flags";
import { featureFlagsLaunchDarklyClientCreate } from "@n8io/baseline-feature-flags/launchdarkly/client";
import type { ReactNode } from "react";
import { flagDefs, flagKinds } from "../flags.ts";
import { FeatureFlagExample } from "./feature-flag-example.tsx";
import { FeatureFlagsProvider } from "./feature-flags.ts";
import type { FeatureFlagsClientConfig } from "./feature-flags-client-config.ts";

export type AppFeatureFlagsClient = FeatureFlagsClient<
	typeof flagDefs,
	typeof flagKinds
>;

// No config, no client: nothing is requested and every flag reads as its fallback.
export const featureFlagsBrowserClientCreate = (
	config: FeatureFlagsClientConfig,
): AppFeatureFlagsClient | null =>
	config === null
		? null
		: featureFlagsLaunchDarklyClientCreate({
				clientSideId: config.clientSideId,
				context: { actor: { id: config.actorId } },
				flags: flagDefs,
				kinds: flagKinds,
			});

// Waits for the flags to settle (at most two seconds, whatever the outcome), so the first client
// render reads the same values the server rendered. React renders the declared fallbacks while it
// hydrates, then the live values, so a flag never causes a hydration mismatch.
export const featureFlagsBrowserWrap = async ({
	client,
	tree,
}: {
	client: AppFeatureFlagsClient | null;
	tree: ReactNode;
}): Promise<ReactNode> => {
	if (client === null) {
		return tree;
	}
	const ready = await client.ready;
	return (
		<FeatureFlagsProvider flags={client.flags} ready={ready}>
			<FeatureFlagExample />
			{tree}
		</FeatureFlagsProvider>
	);
};

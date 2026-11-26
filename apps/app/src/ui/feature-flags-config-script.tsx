// Puts the browser's feature flag config in the page's HTML, where entry.client can read it before
// React Router has built any state. The client-side ID is public by design.
// `pnpm piece-remove feature-flags` deletes this file.
import { useRouteLoaderData } from "react-router";
import { z } from "zod";
import {
	featureFlagsClientConfigSchema,
	featureFlagsClientConfigScriptId,
} from "./feature-flags-client-config.ts";

const RootData = z.object({ featureFlags: featureFlagsClientConfigSchema });

// A JSON data block is never executed, so it needs no CSP nonce. `<` is escaped so the JSON cannot
// close the tag.
export const FeatureFlagsConfigScript = () => {
	const config = RootData.safeParse(useRouteLoaderData("root")).data
		?.featureFlags;
	return config ? (
		<script
			// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON from our own loader, with `<` escaped
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(config).replaceAll("<", "\\u003c"),
			}}
			id={featureFlagsClientConfigScriptId}
			suppressHydrationWarning
			type="application/json"
		/>
	) : null;
};

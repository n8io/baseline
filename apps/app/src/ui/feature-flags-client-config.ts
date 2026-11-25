// What the browser needs to open its feature flags: the public client-side ID and the Actor's id.
// The root loader sends it with the page, and entry.client reads it before hydrating.
// `pnpm piece-remove feature-flags` deletes this file.
import type { Actor } from "@n8io/baseline-authn";
import { createContext, type RouterContext } from "react-router";
import { z } from "zod";

// The client-side ID, in the load context: server.ts sets it from LAUNCHDARKLY_CLIENT_SIDE_ID.
export const featureFlagsClientSideIdContext: RouterContext<string | null> =
	createContext<string | null>(null);

const FeatureFlagsClientConfig = z
	.object({ actorId: z.string(), clientSideId: z.string() })
	.nullable();

export type FeatureFlagsClientConfig = z.infer<typeof FeatureFlagsClientConfig>;

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

// The config in the page's route data, which React Router puts on `window`. Anything else is null.
export const featureFlagsClientConfigRead = (
	routerContext: unknown,
): FeatureFlagsClientConfig =>
	z
		.object({
			state: z.object({
				loaderData: z.object({
					root: z.object({ featureFlags: FeatureFlagsClientConfig }),
				}),
			}),
		})
		.safeParse(routerContext).data?.state.loaderData.root.featureFlags ?? null;

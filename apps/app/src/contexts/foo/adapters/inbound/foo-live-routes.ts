import { authnActorRequire } from "@n8io/baseline-authn";
import { httpRouterCreate } from "@n8io/baseline-http";
import { type LiveHub, liveStreamCreate } from "@n8io/baseline-live";
import type { FooUseCases } from "../../application/foo-use-cases.ts";
import { FooGetInput } from "../../domain/foo.ts";
import { fooHttpErrorAnswer } from "./foo-http.ts";

// Live updates for one foo: the stream opens only if fooGet succeeds for the Actor (cookie auth).
export const fooLiveRoutesCreate = (u: FooUseCases, liveHub: LiveHub) =>
	httpRouterCreate().get("/:fooId", async (c) => {
		const actor = authnActorRequire(c);
		const input = FooGetInput.safeParse(c.req.param());
		// A malformed id names no foo, so it answers like a missing one.
		const result = input.success ? await u.fooGet(actor, input.data) : null;
		if (!result?.ok)
			return fooHttpErrorAnswer(c, {
				type: result?.error.type ?? "FooNotFound",
			});
		const live = liveStreamCreate({
			channel: "foo",
			// No known expiry: the stream's own 5-minute limit applies.
			expiresAt: c.var.authnExpiresAt ?? Number.POSITIVE_INFINITY,
			id: result.value.id,
			liveHub,
			signal: c.req.raw.signal,
		});
		// Through the context, so headers that middleware set with c.header() stay.
		return c.newResponse(live.body, live);
	});

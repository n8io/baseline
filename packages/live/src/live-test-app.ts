import { Hono } from "hono";
import type { LiveHub } from "./index.ts";
import { type LiveStreamTiming, liveStreamBuild } from "./live-stream.ts";

/** An app serving GET /live/:channel/:id like a Project's live routes. */
export const liveTestAppCreate = (
	liveHub: LiveHub,
	options: {
		expiresAt?: () => number;
		timing?: Partial<LiveStreamTiming>;
	} = {},
): Hono =>
	new Hono().get("/live/:channel/:id", (c) => {
		const live = liveStreamBuild(
			{
				channel: c.req.param("channel"),
				expiresAt: (options.expiresAt ?? (() => Date.now() + 15 * 60_000))(),
				id: c.req.param("id"),
				liveHub,
				signal: c.req.raw.signal,
			},
			options.timing,
		);
		// Through the context, so headers that middleware set with c.header() stay.
		return c.newResponse(live.body, live);
	});

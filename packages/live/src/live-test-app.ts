import { Hono } from "hono";
import type { LiveHub } from "./index.ts";
import { liveStreamCreate } from "./index.ts";

// An app serving GET /live/:channel/:id like a project's live routes.
export const liveAppCreate = (
	liveHub: LiveHub,
	expiresAt: () => number = () => Date.now() + 15 * 60_000,
): Hono =>
	new Hono().get("/live/:channel/:id", (c) => {
		const live = liveStreamCreate({
			channel: c.req.param("channel"),
			expiresAt: expiresAt(),
			id: c.req.param("id"),
			liveHub,
			signal: c.req.raw.signal,
		});
		// Through the context, so headers that middleware set with c.header() stay.
		return c.newResponse(live.body, live);
	});

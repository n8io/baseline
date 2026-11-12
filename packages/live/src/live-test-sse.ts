import { Hono } from "hono";
import type { LiveHub } from "./index.ts";
import { liveStreamCreate } from "./index.ts";

// An app serving GET /live/:channel/:id like a project's live routes.
export const liveAppCreate = (
	liveHub: LiveHub,
	expiresAt: () => number = () => Date.now() + 15 * 60_000,
): Hono =>
	new Hono().get("/live/:channel/:id", (c) =>
		liveStreamCreate(c, {
			channel: c.req.param("channel"),
			expiresAt: expiresAt(),
			id: c.req.param("id"),
			liveHub,
		}),
	);

export type SseReader = {
	// Resolves with everything read so far once it contains `text`.
	until(text: string): Promise<string>;
	// Resolves with everything read once the server ends the response.
	end(): Promise<string>;
	cancel(): Promise<void>;
};

export const liveTestSseRead = (response: Response): SseReader => {
	if (response.body === null) throw new TypeError("No body");
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let text = "";
	let done = false;
	const more = async (): Promise<void> => {
		const chunk = await reader.read();
		if (chunk.done) done = true;
		else text += chunk.value;
	};
	return {
		cancel: () => reader.cancel(),
		end: async () => {
			while (!done) await more();
			return text;
		},
		until: async (wanted) => {
			while (!text.includes(wanted)) {
				if (done) throw new Error(`Stream ended without ${wanted}: ${text}`);
				await more();
			}
			return text;
		},
	};
};

import { logger } from "@n8io/baseline-logger";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { type LiveHub, liveHubStreams } from "./live-hub.ts";

export const liveHeartbeatMs: number = 20_000;
export const liveStreamMaxMs: number = 5 * 60_000;

// Spread reconnects over 1–5 s so a restart or a token expiry wave does not
// bring every page back at once.
const liveRetryMs = (): number => 1000 + Math.floor(Math.random() * 4001);

/**
 * An SSE response that sends a `ready` event once subscribed, then `{ type, id }`
 * for each live update on (channel, id). It sends a comment every 20 s and closes after 5 minutes, or
 * at `expiresAt` (epoch ms) if sooner, and when `liveHub.close()` runs; each
 * close sends a `retry:` of 1–5 s first. The page revalidates on reconnect.
 */
export const liveStreamCreate = (
	c: Context,
	{
		channel,
		expiresAt,
		id,
		liveHub,
	}: { liveHub: LiveHub; channel: string; id: string; expiresAt: number },
): Response => {
	const streams = liveHubStreams(liveHub);
	return streamSSE(c, async (stream) => {
		const stop = Promise.withResolvers<void>();
		const finished = Promise.withResolvers<void>();
		const untrack = streams.track(async () => {
			stop.resolve();
			await finished.promise;
		});
		stream.onAbort(() => {
			stop.resolve();
		});
		const lifetime = setTimeout(
			stop.resolve,
			Math.max(0, Math.min(liveStreamMaxMs, expiresAt - Date.now())),
		);
		const heartbeat = setInterval(() => {
			void stream.write(": heartbeat\n\n");
		}, liveHeartbeatMs);
		let unlisten = (): void => {};
		try {
			if (streams.isClosed()) return;
			const listening = streams.listen(channel, id, (update) => {
				void stream.writeSSE({ data: JSON.stringify(update) });
			});
			// Never let a slow subscribe hold up close() or the lifetime.
			const ready = await Promise.race([listening, stop.promise]);
			if (ready === undefined) {
				listening.then((late) => late()).catch(() => undefined);
				return;
			}
			unlisten = ready;
			// EventSource's open fires on the headers, before this subscribe is
			// done; the page revalidates on this event instead, so no update
			// falls between its loader run and the subscribe.
			await stream.writeSSE({ data: "", event: "ready" });
			await stop.promise;
		} catch (err) {
			logger.error({ err }, "Live stream failed to subscribe");
		} finally {
			unlisten();
			clearTimeout(lifetime);
			clearInterval(heartbeat);
			untrack();
			if (!stream.aborted) await stream.write(`retry: ${liveRetryMs()}\n\n`);
			finished.resolve();
		}
	});
};

import { logger } from "@n8io/baseline-logger";
import { type LiveHub, liveHubStreams } from "./live-hub.ts";

export const liveHeartbeatMs: number = 20_000;
export const liveStreamMaxMs: number = 5 * 60_000;

// Spread reconnects over 1–5 s so a restart or a token expiry wave does not
// bring every page back at once.
const liveRetryMs = (): number => 1000 + Math.floor(Math.random() * 4001);

// A page that stops reading is dropped once this much is waiting for it; it reconnects and
// revalidates. So is a page sent more than this in one tick, which costs it only a reconnect.
const liveStreamBufferBytes = 64 * 1024;

/**
 * An SSE response that sends a `ready` event once subscribed, then `{ type, id }`
 * for each live update on (channel, id). It sends `ready` again, 1–5 s after the hub
 * says updates may have been lost, so the page revalidates. It sends a comment every 20 s and closes after 5 minutes, or
 * at `expiresAt` (epoch ms) if sooner, and when `liveHub.close()` runs; each
 * close sends a `retry:` of 1–5 s first. The page revalidates on reconnect.
 * Pass the request's `signal` so the stream also ends when the request is aborted. The response
 * carries only its own headers: answer through your framework (`c.newResponse(live.body, live)`
 * in Hono) to keep the ones earlier middleware set.
 */
export const liveStreamCreate = ({
	channel,
	expiresAt,
	id,
	liveHub,
	signal,
}: {
	liveHub: LiveHub;
	channel: string;
	id: string;
	expiresAt: number;
	signal?: AbortSignal;
}): Response => {
	const streams = liveHubStreams(liveHub);
	const encoder = new TextEncoder();
	const stop = Promise.withResolvers<void>();
	// True once the page is gone: nothing more can be written.
	let aborted = false;
	const abort = (): void => {
		aborted = true;
		stop.resolve();
	};

	const run = async (write: (text: string) => void): Promise<void> => {
		const finished = Promise.withResolvers<void>();
		const untrack = streams.track(async () => {
			stop.resolve();
			await finished.promise;
		});
		if (signal?.aborted) abort();
		signal?.addEventListener("abort", abort, { once: true });
		const lifetime = setTimeout(
			stop.resolve,
			Math.max(0, Math.min(liveStreamMaxMs, expiresAt - Date.now())),
		);
		const heartbeat = setInterval(() => {
			write(": heartbeat\n\n");
		}, liveHeartbeatMs);
		let unlisten = (): void => {};
		let resyncTimer: NodeJS.Timeout | undefined;
		// EventSource's open fires on the headers, before this subscribe is
		// done; the page revalidates on this event instead, so no update
		// falls between its loader run and the subscribe.
		const ready = (): void => {
			write("event: ready\ndata: \n\n");
		};
		try {
			if (streams.isClosed() || aborted) return;
			const listening = streams.listen({
				channel,
				id,
				listener: (update) => {
					write(`data: ${JSON.stringify(update)}\n\n`);
				},
				// Spread like a reconnect, so a Redis failover does not rerun every loader at once.
				resync: () => {
					clearTimeout(resyncTimer);
					resyncTimer = setTimeout(ready, liveRetryMs());
				},
			});
			// Never let a slow subscribe hold up close() or the lifetime.
			const listened = await Promise.race([listening, stop.promise]);
			if (listened === undefined) {
				listening.then((late) => late()).catch(() => undefined);
				return;
			}
			unlisten = listened;
			ready();
			await stop.promise;
		} catch (err) {
			logger.error({ err }, "Live stream failed to subscribe");
		} finally {
			unlisten();
			clearTimeout(resyncTimer);
			clearTimeout(lifetime);
			clearInterval(heartbeat);
			signal?.removeEventListener("abort", abort);
			untrack();
			write(`retry: ${liveRetryMs()}\n\n`);
			finished.resolve();
		}
	};

	// True once the reader cancelled: the controller can no longer be closed.
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>(
		{
			cancel: () => {
				cancelled = true;
				abort();
			},
			start: (controller) => {
				let closed = false;
				const write = (text: string): void => {
					if (aborted || closed) return;
					controller.enqueue(encoder.encode(text));
					if ((controller.desiredSize ?? 0) <= 0) stop.resolve();
				};
				void run(write).finally(() => {
					closed = true;
					if (!cancelled) controller.close();
				});
			},
		},
		{ highWaterMark: liveStreamBufferBytes, size: (chunk) => chunk.byteLength },
	);
	return new Response(body, {
		headers: {
			"Cache-Control": "no-cache",
			"Content-Type": "text/event-stream",
		},
	});
};

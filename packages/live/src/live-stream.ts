import { type LiveHub, liveHubStreams } from "./live-hub.ts";
import { liveLoggerDefault as logger } from "./live-logger-default.ts";

/** How often a stream sends a comment to keep the connection open. */
export const liveHeartbeatMs: number = 20_000;
/** The longest a stream stays open before it asks the page to reconnect. */
export const liveStreamMaxMs: number = 5 * 60_000;

// Spread reconnects over 1–5 s so a restart or a token expiry wave does not
// bring every page back at once.
export const liveRetryMs = (random: () => number = Math.random): number =>
	1000 + Math.floor(random() * 4001);

/** The clock and timings of a stream; a test shortens them. `liveStreamCreate` uses the defaults. */
export type LiveStreamTiming = {
	heartbeatMs: number;
	maxMs: number;
	now: () => number;
	retryMs: () => number;
};

// A page that stops reading is dropped once this much is waiting for it; it reconnects and
// revalidates. So is a page sent more than this in one tick, which costs it only a reconnect.
const liveStreamBufferBytes = 64 * 1024;

/** What `liveStreamCreate` takes. */
export type LiveStreamOptions = {
	/** The channel the updates are sent on, such as `invoice`. */
	channel: string;
	/** When the stream closes at the latest, in epoch ms, such as the session's expiry. */
	expiresAt: number;
	/** The id within the channel whose updates the stream carries. */
	id: string;
	/** The hub from `liveHubRedisCreate` or `liveHubMemoryCreate`. */
	liveHub: LiveHub;
	/** The request's signal, so the stream ends when the request is aborted. */
	signal?: AbortSignal | null;
};

/**
 * An SSE response that sends a `ready` event once subscribed, then `{ type, id }`
 * for each Live update on (channel, id). It sends `ready` again, 1–5 s after the hub
 * says updates may have been lost, so the page revalidates. It sends a comment every 20 s and closes after 5 minutes, or
 * at `expiresAt` (epoch ms) if sooner, and when `liveHub.close()` runs; each
 * close sends a `retry:` of 1–5 s first. The page revalidates on reconnect.
 * Pass the request's `signal` so the stream also ends when the request is aborted. The response
 * carries only its own headers: answer through your framework (`c.newResponse(live.body, live)`
 * in Hono) to keep the ones earlier middleware set. Throws `TypeError` on an `expiresAt` that is
 * not a number, or a `liveHub` from another factory.
 */
export const liveStreamCreate = (options: LiveStreamOptions): Response =>
	liveStreamBuild(options);

/** `liveStreamCreate` with its timings handed in, for tests that cannot wait 20 s or 5 minutes. */
export const liveStreamBuild = (
	{ channel, expiresAt, id, liveHub, signal }: LiveStreamOptions,
	timing: Partial<LiveStreamTiming> = {},
): Response => {
	const heartbeatMs = timing.heartbeatMs ?? liveHeartbeatMs;
	const maxMs = timing.maxMs ?? liveStreamMaxMs;
	const now = timing.now ?? Date.now;
	const retryMs = timing.retryMs ?? liveRetryMs;
	if (typeof expiresAt !== "number" || Number.isNaN(expiresAt)) {
		throw new TypeError(
			`liveStreamCreate: expiresAt must be a number of epoch ms, found ${String(expiresAt)}`,
		);
	}
	const streams = liveHubStreams(liveHub, "liveStreamCreate");
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
			Math.max(0, Math.min(maxMs, expiresAt - now())),
		);
		const heartbeat = setInterval(() => {
			write(": heartbeat\n\n");
		}, heartbeatMs);
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
				// A loss while one is pending is covered by it, so a flapping Redis cannot put it off.
				resync: () => {
					resyncTimer ??= setTimeout(() => {
						resyncTimer = undefined;
						ready();
					}, retryMs());
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
			logger().error({ err }, "Live stream failed to subscribe");
		} finally {
			unlisten();
			clearTimeout(resyncTimer);
			clearTimeout(lifetime);
			clearInterval(heartbeat);
			signal?.removeEventListener("abort", abort);
			untrack();
			write(`retry: ${retryMs()}\n\n`);
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

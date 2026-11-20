type LiveEventSource = {
	addEventListener(type: "message" | "ready", listener: () => void): void;
	close(): void;
};

/** Opens an EventSource on a URL; the browser's in `useLiveUpdates`, a fake in tests. */
export type LiveEventSourceCreate = (url: string) => LiveEventSource;

/**
 * Opens the stream at `<pathPrefix>/<channel>/<id>` and calls `onChange` on every Live update
 * and every (re)connect, since updates sent while it was down are not resent.
 * The Server sends `ready` once each connection is subscribed, and again when it may have
 * lost updates itself.
 * A null `id` opens no stream and returns a close that does nothing.
 * Returns the close. EventSource reconnects after the Server's `retry:`.
 */
export const liveUpdatesOpen = ({
	channel,
	eventSourceCreate,
	id,
	onChange,
	pathPrefix,
}: {
	channel: string;
	eventSourceCreate: LiveEventSourceCreate;
	id: string | null;
	onChange: () => void;
	pathPrefix?: string | null;
}): (() => void) => {
	if (id === null) return () => undefined;
	const prefix = pathPrefix ?? "/live";
	const source = eventSourceCreate(
		`${prefix}/${encodeURIComponent(channel)}/${encodeURIComponent(id)}`,
	);
	source.addEventListener("ready", onChange);
	source.addEventListener("message", onChange);
	return () => {
		source.close();
	};
};

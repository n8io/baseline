type LiveEventSource = {
	addEventListener(type: "message" | "ready", listener: () => void): void;
	close(): void;
};

export type LiveEventSourceCreate = (url: string) => LiveEventSource;

// Opens the stream at `<pathPrefix>/<channel>/<id>` and calls `onChange` on every live update
// and every (re)connect, since updates sent while it was down are not resent.
// The server sends `ready` once each connection is subscribed.
// Returns the close. EventSource reconnects after the server's `retry:`.
export const liveUpdatesOpen = ({
	channel,
	eventSourceCreate,
	id,
	onChange,
	pathPrefix = "/live",
}: {
	channel: string;
	eventSourceCreate: LiveEventSourceCreate;
	id: string;
	onChange: () => void;
	pathPrefix?: string;
}): (() => void) => {
	const source = eventSourceCreate(
		`${pathPrefix}/${encodeURIComponent(channel)}/${encodeURIComponent(id)}`,
	);
	source.addEventListener("ready", onChange);
	source.addEventListener("message", onChange);
	return () => {
		source.close();
	};
};

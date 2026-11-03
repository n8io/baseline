import { useEffect } from "react";
import { useRevalidator } from "react-router";
import {
	type LiveEventSourceCreate,
	liveUpdatesOpen,
} from "./live-updates-open.ts";

type BrowserGlobal = {
	EventSource: new (url: string) => ReturnType<LiveEventSourceCreate>;
};

const eventSourceCreate: LiveEventSourceCreate = (url) =>
	new (globalThis as unknown as BrowserGlobal).EventSource(url);

/**
 * Reruns the page's loaders whenever (channel, id) changes on the server, and
 * whenever the stream at `/live/<channel>/<id>` (re)connects.
 */
export const useLiveUpdates = (channel: string, id: string): void => {
	const { revalidate } = useRevalidator();
	useEffect(
		() =>
			liveUpdatesOpen(
				channel,
				id,
				() => {
					void revalidate();
				},
				eventSourceCreate,
			),
		[channel, id, revalidate],
	);
};

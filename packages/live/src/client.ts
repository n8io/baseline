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

export type LiveUpdatesOptions = {
	channel: string;
	/** `null` opens no stream, for a page that has no id to follow yet. */
	id: string | null;
	/** Where the server mounts the streams. Defaults to `/live`. */
	pathPrefix?: string;
};

/**
 * Reruns the page's loaders whenever (channel, id) changes on the server, and
 * whenever the stream at `<pathPrefix>/<channel>/<id>` (re)connects.
 */
export const useLiveUpdates = ({
	channel,
	id,
	pathPrefix = "/live",
}: LiveUpdatesOptions): void => {
	const { revalidate } = useRevalidator();
	useEffect(
		() =>
			liveUpdatesOpen({
				channel,
				eventSourceCreate,
				id,
				onChange: () => {
					void revalidate();
				},
				pathPrefix,
			}),
		[channel, id, pathPrefix, revalidate],
	);
};

import { type LiveHub, liveHubCreate } from "./live-hub.ts";

// A hub for one process (development, tests): updates reach only its own streams.
export const liveHubMemoryCreate = (): LiveHub => {
	const delivers = new Map<string, (message: string) => void>();
	return liveHubCreate({
		close: async () => {},
		publish: async (channel, message) => {
			delivers.get(channel)?.(message);
		},
		subscribe: async (channel, deliver) => {
			delivers.set(channel, deliver);
		},
	});
};

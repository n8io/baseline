// What an Actor did, for funnels and retention. Properties carry ids and counts only, never a
// Model, an input or personal data. Vendor-neutral: each adapter maps it to its own API.
export type AnalyticsEvent = {
	name: string;
	actorId: string;
	properties?: Record<string, boolean | number | string>;
};

export type Analytics = {
	// Returns at once and never throws: a send that fails is logged and dropped.
	track(event: AnalyticsEvent): void;
	// Waits for the sends in flight.
	close(): Promise<void>;
	// Calls close(), so `await using` closes it when its block ends.
	[Symbol.asyncDispose](): Promise<void>;
};

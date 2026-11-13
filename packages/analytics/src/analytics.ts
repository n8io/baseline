// What an Actor did, for funnels and retention. Properties carry ids and counts only, never a
// Model, an input or personal data.
export type AnalyticsEvent = {
	name: string;
	// The Actor's id: Mixpanel's distinct_id.
	distinctId: string;
	properties?: Record<string, boolean | number | string>;
};

export type Analytics = {
	// Returns at once and never throws: a send that fails is logged and dropped.
	track(event: AnalyticsEvent): void;
	// Waits for the sends in flight.
	close(): Promise<void>;
};

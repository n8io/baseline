// Sends Error reports: an unexpected error, with its class name, stack frames, cause chain and
// trace id, to error tracking for triage. Never its message, which can hold input text.
// Vendor-neutral: each adapter maps a report to its own API.
export type ErrorTracking = {
	// Returns at once and never throws: a report that cannot be sent is dropped.
	report(error: unknown): void;
	// Waits, for a bounded time, for the reports in flight, then stops sending.
	close(): Promise<void>;
};

import { setTimeout as sleep } from "node:timers/promises";

/**
 * Runs `check` every `interval` ms until it returns without throwing, and rejects with its last
 * error once `timeout` ms have passed. Resolves with what `check` returned.
 */
export const queueWaitFor = async <Value>(
	check: () => Promise<Value> | Value,
	{
		interval = 50,
		timeout = 1_000,
	}: { interval?: number; timeout?: number } = {},
): Promise<Value> => {
	const deadline = Date.now() + timeout;
	for (;;) {
		try {
			return await check();
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
		}
		await sleep(interval);
	}
};

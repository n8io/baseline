/**
 * Pins `Date.now` for a test that reads the clock, such as a liveness limit a minute away. Declare
 * it with `using`: the real `Date.now` returns when the block ends. `set` moves the pinned time.
 */
export const queueDateNowPin = (
	initial: number,
): { set: (value: number) => void; [Symbol.dispose]: () => void } => {
	const original = Date.now;
	let pinned = initial;
	Date.now = () => pinned;
	return {
		set: (value) => {
			pinned = value;
		},
		[Symbol.dispose]: () => {
			Date.now = original;
		},
	};
};

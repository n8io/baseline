// What a Use case reads the time from, so a test sets the time instead of faking timers.
export type Clock = {
	now(): Date;
};

// The memory Clock: stands still until a test sets or advances it.
export type ClockMemory = Clock & {
	advance(ms: number): void;
	set(date: Date): void;
};

export const clockSystemCreate = (): Clock => ({ now: () => new Date() });

// Starts at `start`, or at the system time when it was created.
export const clockMemoryCreate = (start?: Date | null): ClockMemory => {
	let current = start ? start.getTime() : Date.now();
	return {
		advance: (ms) => {
			current += ms;
		},
		now: () => new Date(current),
		set: (date) => {
			current = date.getTime();
		},
	};
};

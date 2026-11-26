import { afterEach, describe, expect, it } from "vitest";
import {
	sharedConnectionSslAssert,
	sharedConnectionUrlAssert,
	sharedIntegerAssert,
	sharedKeepAlive,
	sharedTimeLimit,
	sharedTimeRace,
	sharedTimerMaxMs,
	sharedTimeTimer,
} from "./index.ts";

describe("sharedTimeLimit", () => {
	it("settles like the work when it finishes first", async () => {
		await expect(
			sharedTimeLimit({ message: "slow", ms: 1000, work: Promise.resolve(7) }),
		).resolves.toBe(7);
		await expect(
			sharedTimeLimit({
				message: "slow",
				ms: 1000,
				work: Promise.reject(new Error("no")),
			}),
		).rejects.toThrow("no");
	});

	it("rejects with a TimeoutError carrying the message when the timer wins", async () => {
		const error = await sharedTimeLimit({
			message: "Redis not ready",
			ms: 5,
			work: new Promise<never>(() => undefined),
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(DOMException);
		expect(error).toHaveProperty("name", "TimeoutError");
		expect(error).toHaveProperty("message", "Redis not ready");
	});
});

describe("sharedTimeRace", () => {
	it("resolves the value when the timer wins, and the work when it wins", async () => {
		await expect(
			sharedTimeRace({
				ms: 5,
				value: "timeout",
				work: new Promise<never>(() => undefined),
			}),
		).resolves.toBe("timeout");
		await expect(
			sharedTimeRace({
				ms: 1000,
				value: "timeout",
				work: Promise.resolve("done"),
			}),
		).resolves.toBe("done");
	});
});

describe("sharedTimeRace bounds", () => {
	const workAfter = (ms: number): Promise<string> =>
		new Promise((resolve) => {
			setTimeout(() => resolve("work"), ms);
		});

	it("resolves the value at once for 0 and for a negative wait", async () => {
		for (const ms of [0, -5]) {
			await expect(
				sharedTimeRace({ ms, value: "timeout", work: workAfter(50) }),
			).resolves.toBe("timeout");
		}
	});

	it.each([
		sharedTimerMaxMs - 1,
		sharedTimerMaxMs,
		sharedTimerMaxMs + 1,
		sharedTimerMaxMs * 2 + 10,
		Number.POSITIVE_INFINITY,
	])("keeps waiting for a wait of %s ms, so the work wins", async (ms) => {
		await expect(
			sharedTimeRace({ ms, value: "timeout", work: workAfter(40) }),
		).resolves.toBe("work");
	});

	it("limits a wait over the cap with the work, not a TimeoutError after 1 ms", async () => {
		await expect(
			sharedTimeLimit({
				message: "slow",
				ms: sharedTimerMaxMs + 1000,
				work: workAfter(40),
			}),
		).resolves.toBe("work");
	});
});

describe("sharedTimeTimer", () => {
	it("resolves its value after the wait", async () => {
		await expect(sharedTimeTimer({ ms: 5, value: "up" }).promise).resolves.toBe(
			"up",
		);
	});

	it("never settles once cleared", async () => {
		const timer = sharedTimeTimer({ ms: 5, value: "up" });
		timer.clear();
		await expect(
			Promise.race([
				timer.promise,
				new Promise<string>((resolve) => {
					setTimeout(() => resolve("later"), 30);
				}),
			]),
		).resolves.toBe("later");
	});
});

describe("sharedIntegerAssert", () => {
	const check = (value: number, max?: number): void =>
		sharedIntegerAssert({
			caller: "fooCreate",
			max: max ?? null,
			min: 1,
			name: "size",
			value,
		});

	it("accepts a whole number in range", () => {
		expect(() => check(1)).not.toThrow();
		expect(() => check(sharedTimerMaxMs, sharedTimerMaxMs)).not.toThrow();
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"throws a TypeError naming the caller and option on %s",
		(value) => {
			expect(() => check(value)).toThrow(
				new TypeError(
					`fooCreate: size must be a whole number, 1 or more, found ${value}`,
				),
			);
		},
	);

	it("names the range when there is a maximum", () => {
		expect(() => check(sharedTimerMaxMs + 1, sharedTimerMaxMs)).toThrow(
			new TypeError(
				`fooCreate: size must be a whole number from 1 to ${sharedTimerMaxMs}, found ${sharedTimerMaxMs + 1}`,
			),
		);
	});
});

describe("sharedKeepAlive", () => {
	it("keeps idle connections open for 65 s with the headers timeout above", () => {
		const server = { headersTimeout: 0, keepAliveTimeout: 0 };

		sharedKeepAlive(server);

		expect(server).toEqual({
			headersTimeout: 66_000,
			keepAliveTimeout: 65_000,
		});
	});
});

describe("connection checks", () => {
	it("accepts postgres:// and postgresql:// and names the scheme, never the URL, otherwise", () => {
		expect(() =>
			sharedConnectionUrlAssert("postgres://u:pw@h/db", "fooCreate"),
		).not.toThrow();
		expect(() =>
			sharedConnectionUrlAssert("postgresql://h/db", "fooCreate"),
		).not.toThrow();
		expect(() =>
			sharedConnectionUrlAssert("mysql://u:secret@h/db", "fooCreate"),
		).toThrow(
			new TypeError(
				'fooCreate: databaseUrl must start with postgres:// or postgresql://, found "mysql://"',
			),
		);
		expect(() => sharedConnectionUrlAssert("h/db", "fooCreate")).toThrow(
			/found no scheme/,
		);
	});

	it("refuses vendor.ssl beside an ssl URL parameter and an unparsable URL", () => {
		expect(() =>
			sharedConnectionSslAssert({
				caller: "fooCreate",
				databaseUrl: "postgres://h/db?sslmode=require",
				vendor: { ssl: true },
			}),
		).toThrow(/vendor\.ssl is not allowed with sslmode/);
		expect(() =>
			sharedConnectionSslAssert({
				caller: "fooCreate",
				databaseUrl: "postgres://h/db",
				vendor: { ssl: true },
			}),
		).not.toThrow();
		expect(() =>
			sharedConnectionSslAssert({
				caller: "fooCreate",
				databaseUrl: "not a url secret",
				vendor: {},
			}),
		).toThrow(new TypeError("fooCreate: databaseUrl is not a valid URL"));
	});
});

describe("sharedConnectionUrlAssert anchors", () => {
	it("refuses a URL that only holds a postgres scheme after other text", () => {
		expect(() =>
			sharedConnectionUrlAssert("mysql://h/postgres://x", "fooCreate"),
		).toThrow(/found "mysql:\/\/"/);
	});

	it("reads the scheme from the start only", () => {
		expect(() =>
			sharedConnectionUrlAssert("h/db?next=https://x", "fooCreate"),
		).toThrow(/found no scheme/);
	});
});

describe("sharedConnectionSslAssert parameters", () => {
	it.each(["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"])(
		"names %s when vendor.ssl sets TLS too",
		(name) => {
			expect(() =>
				sharedConnectionSslAssert({
					caller: "fooCreate",
					databaseUrl: `postgres://h/db?${name}=x`,
					vendor: { ssl: false },
				}),
			).toThrow(
				new TypeError(
					`fooCreate: vendor.ssl is not allowed with ${name} in databaseUrl: pg lets the URL win; set TLS in one place`,
				),
			);
		},
	);

	it("allows an ssl URL parameter when the vendor sets no ssl", () => {
		expect(() =>
			sharedConnectionSslAssert({
				caller: "fooCreate",
				databaseUrl: "postgres://h/db?sslmode=require",
				vendor: {},
			}),
		).not.toThrow();
	});
});

type FakeTimer = {
	cleared: boolean;
	fire: () => void;
	hasRef: () => boolean;
	ms: number;
	unref: () => FakeTimer;
};

describe("sharedTimeTimer on a hand-written clock", () => {
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;

	afterEach(() => {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	});

	/** Swaps the global timers for ones that record each call and fire only when told to. */
	const clockInstall = (
		handle?: (timer: FakeTimer) => unknown,
	): FakeTimer[] => {
		const timers: FakeTimer[] = [];
		globalThis.setTimeout = ((run: () => void, ms: number) => {
			let ref = true;
			const timer: FakeTimer = {
				cleared: false,
				fire: () => {
					if (!timer.cleared) run();
				},
				hasRef: () => ref,
				ms,
				unref: () => {
					ref = false;
					return timer;
				},
			};
			timers.push(timer);
			return handle ? handle(timer) : timer;
		}) as unknown as typeof setTimeout;
		globalThis.clearTimeout = ((timer: FakeTimer) => {
			timer.cleared = true;
		}) as unknown as typeof clearTimeout;
		return timers;
	};

	const flush = (): Promise<void> =>
		new Promise((resolve) => realSetTimeout(resolve, 0));

	it("waits the whole of a wait over the cap, in steps", async () => {
		const timers = clockInstall();
		let settled = false;
		void sharedTimeTimer({
			ms: sharedTimerMaxMs + 1000,
			value: "up",
		}).promise.then(() => {
			settled = true;
		});

		expect(timers.map((timer) => timer.ms)).toEqual([sharedTimerMaxMs]);
		timers[0]?.fire();
		await flush();
		expect(settled).toBe(false);
		expect(timers.map((timer) => timer.ms)).toEqual([sharedTimerMaxMs, 1000]);
		timers[1]?.fire();
		await flush();
		expect(settled).toBe(true);
	});

	it("unrefs its timer unless ref is true", () => {
		const timers = clockInstall();
		sharedTimeTimer({ ms: 10, value: 1 });
		sharedTimeTimer({ ms: 10, ref: false, value: 1 });
		sharedTimeTimer({ ms: 10, ref: true, value: 1 });

		expect(timers.map((timer) => timer.hasRef())).toEqual([false, false, true]);
	});

	it("leaves a timer handle that is not an object alone", () => {
		clockInstall(() => 7);

		expect(() => sharedTimeTimer({ ms: 10, value: 1 })).not.toThrow();
	});

	it("clears its timer once the race ends, whichever side wins", async () => {
		const timers = clockInstall();
		await sharedTimeRace({ ms: 1000, value: "t", work: Promise.resolve(1) });
		expect(timers.map((timer) => timer.cleared)).toEqual([true]);

		const lost = sharedTimeRace({
			ms: 1000,
			value: "t",
			work: new Promise<never>(() => undefined),
		});
		timers[1]?.fire();
		await expect(lost).resolves.toBe("t");
		expect(timers.map((timer) => timer.cleared)).toEqual([true, true]);
	});

	it("clears its timer when the work rejects", async () => {
		const timers = clockInstall();
		await expect(
			sharedTimeRace({
				ms: 1000,
				value: "t",
				work: Promise.reject(new Error("no")),
			}),
		).rejects.toThrow("no");
		expect(timers.map((timer) => timer.cleared)).toEqual([true]);
	});
});

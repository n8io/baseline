import type { Logger } from "@n8io/baseline-logger";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type ShutdownHost,
	type ShutdownStep,
	shutdownHandleCreate,
} from "./shutdown-handle.ts";

type Listener = (value: unknown) => void;
type LogCall = [fields: unknown, message?: string];
type LogMethod = "error" | "fatal" | "info" | "warn";

const logMethods: LogMethod[] = ["error", "fatal", "info", "warn"];

// A manual clock: sleeps resolve only when the test advances it, in due order.
const clockCreate = () => {
	let now = 0;
	let seq = 0;
	const timers: { at: number; resolve: () => void; seq: number }[] = [];
	// Lets every promise chain the last resolve started run to its end.
	const settle = (): Promise<void> =>
		new Promise((resolve) => setImmediate(resolve));
	const advance = async (ms: number): Promise<void> => {
		const target = now + ms;
		await settle();
		for (;;) {
			const due = timers
				.filter((timer) => timer.at <= target)
				.sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
			if (!due) {
				break;
			}
			timers.splice(timers.indexOf(due), 1);
			now = Math.max(now, due.at);
			due.resolve();
			await settle();
		}
		now = target;
	};
	return {
		advance,
		runAll: async (): Promise<void> => {
			while (timers.length > 0) {
				await advance(Math.min(...timers.map((timer) => timer.at)) - now);
			}
		},
		sleep: (ms: number): Promise<void> =>
			new Promise((resolve) => {
				timers.push({ at: now + Math.max(0, ms), resolve, seq: seq++ });
			}),
	};
};

// A fake process: listeners are captured instead of registered, exit is recorded.
let listeners: Map<string, Listener>;
let exits: number[];
let events: string[];
let clock: ReturnType<typeof clockCreate>;
let host: ShutdownHost;
let logs: Record<LogMethod, LogCall[]>;
// Records each call in `logs`; the host hands it to the handle.
const loggerDouble = {} as Record<LogMethod, Logger[LogMethod]>;

// Node passes a signal listener the signal's name.
const emit = (event: string, value: unknown = event): void => {
	const listener = listeners.get(event);
	if (!listener) {
		throw new Error(`no listener for ${event}`);
	}
	listener(value);
};

const never = (): Promise<void> => new Promise(() => undefined);

// A step that records when it starts and finishes closing, taking `ms` to close.
const step = (name: string, ms = 0): ShutdownStep => ({
	close: async () => {
		events.push(`${name}:start`);
		if (ms > 0) {
			await clock.sleep(ms);
		}
		events.push(`${name}:done`);
	},
	name,
});

const failing = (name: string): ShutdownStep => ({
	close: () => {
		events.push(`${name}:start`);
		return Promise.reject(new Error("boom"));
	},
	name,
});

const hanging = (name: string): ShutdownStep => ({
	close: () => {
		events.push(`${name}:start`);
		return never();
	},
	name,
});

beforeEach(() => {
	clock = clockCreate();
	listeners = new Map();
	exits = [];
	events = [];
	host = {
		exit: (code) => {
			exits.push(code);
		},
		on: (event, listener) => {
			listeners.set(event, listener);
		},
		sleep: clock.sleep,
	};
	logs = { error: [], fatal: [], info: [], warn: [] };
	for (const method of logMethods) {
		loggerDouble[method] = ((...args: LogCall) => {
			logs[method].push(args);
		}) as Logger[typeof method];
	}
	host.logger = loggerDouble;
});

describe("shutdownHandleCreate", () => {
	it("owns SIGTERM, SIGINT, uncaughtException and unhandledRejection", () => {
		shutdownHandleCreate({ host, intakes: [], resources: [] });

		expect([...listeners.keys()].sort()).toEqual([
			"SIGINT",
			"SIGTERM",
			"uncaughtException",
			"unhandledRejection",
		]);
	});

	it("closes intakes together, then resources one by one in order, and exits 0", async () => {
		shutdownHandleCreate({
			host,
			drainDelayMs: 0,
			intakes: [step("http", 300), step("live", 100)],
			resources: [step("postgres", 200), step("health", 0), step("telemetry")],
		});

		emit("SIGTERM");
		await clock.runAll();

		expect(events).toEqual([
			"http:start",
			"live:start",
			"live:done",
			"http:done",
			"postgres:start",
			"postgres:done",
			"health:start",
			"health:done",
			"telemetry:start",
			"telemetry:done",
		]);
		expect(exits).toEqual([0]);
	});

	it("reports shutting down at once and keeps serving for the drain delay", async () => {
		const handle = shutdownHandleCreate({
			host,
			drainDelayMs: 5000,
			intakes: [step("http")],
			resources: [],
		});

		expect(handle.isShuttingDown()).toBe(false);
		emit("SIGTERM");
		expect(handle.isShuttingDown()).toBe(true);

		await clock.advance(4999);
		expect(events).toEqual([]);

		await clock.advance(1);
		expect(events).toEqual(["http:start", "http:done"]);
		expect(exits).toEqual([0]);
	});

	it("defaults to a 5 s drain delay", async () => {
		shutdownHandleCreate({ host, intakes: [step("http")], resources: [] });

		emit("SIGINT");
		await clock.advance(4999);
		expect(events).toEqual([]);

		await clock.advance(1);
		expect(events).toEqual(["http:start", "http:done"]);
	});

	it("stops waiting for intakes 5 s before the deadline, logs each straggler and still closes the resources", async () => {
		shutdownHandleCreate({
			host,
			intakes: [hanging("http"), step("live"), hanging("queue")],
			resources: [step("postgres"), step("telemetry")],
		});

		emit("SIGTERM");
		await clock.advance(19_999);
		expect(events).toEqual([
			"http:start",
			"live:start",
			"live:done",
			"queue:start",
		]);
		expect(logs.warn).toEqual([]);

		await clock.advance(1);
		expect(logs.warn).toEqual([
			["Intake http still open at the cutoff"],
			["Intake queue still open at the cutoff"],
		]);
		expect(events.slice(4)).toEqual([
			"postgres:start",
			"postgres:done",
			"telemetry:start",
			"telemetry:done",
		]);
		expect(exits).toEqual([1]);
	});

	it("counts the cutoff and deadline from the signal, drain delay included", async () => {
		shutdownHandleCreate({
			host,
			deadlineMs: 10_000,
			drainDelayMs: 3000,
			intakes: [hanging("http")],
			resources: [hanging("postgres"), step("telemetry")],
		});

		emit("SIGTERM");
		await clock.advance(4999);
		expect(events).toEqual(["http:start"]);

		await clock.advance(1);
		expect(events).toEqual(["http:start", "postgres:start"]);

		await clock.advance(4999);
		expect(exits).toEqual([]);

		await clock.advance(1);
		expect(logs.error).toEqual([
			["Resource postgres still open at the deadline"],
			["Resource telemetry still open at the deadline"],
		]);
		expect(exits).toEqual([1]);
	});

	it("logs and skips a failing intake or resource, then exits 1", async () => {
		shutdownHandleCreate({
			host,
			drainDelayMs: 0,
			intakes: [failing("http"), step("queue")],
			resources: [failing("postgres"), step("telemetry")],
		});

		emit("SIGTERM");
		await clock.runAll();

		expect(events).toEqual([
			"http:start",
			"queue:start",
			"queue:done",
			"postgres:start",
			"telemetry:start",
			"telemetry:done",
		]);
		expect(logs.error).toEqual([
			[{ err: expect.any(Error) }, "Intake http failed to close"],
			[{ err: expect.any(Error) }, "Resource postgres failed to close"],
		]);
		expect(exits).toEqual([1]);
	});

	it("logs a step that throws instead of rejecting", async () => {
		shutdownHandleCreate({
			host,
			drainDelayMs: 0,
			intakes: [],
			resources: [
				{
					close: () => {
						throw new TypeError("sync");
					},
					name: "cache",
				},
				step("telemetry"),
			],
		});

		emit("SIGTERM");
		await clock.runAll();

		expect(logs.error).toEqual([
			[{ err: expect.any(TypeError) }, "Resource cache failed to close"],
		]);
		expect(events).toEqual(["telemetry:start", "telemetry:done"]);
		expect(exits).toEqual([1]);
	});

	it("still exits 1 when the shutdown itself throws", async () => {
		shutdownHandleCreate({
			host,
			drainDelayMs: 0,
			intakes: [],
			resources: [failing("postgres")],
		});
		loggerDouble.error = (() => {
			throw new Error("stdout closed");
		}) as Logger["error"];

		emit("SIGTERM");
		await clock.runAll();
		expect(events).toEqual(["postgres:start"]);
		expect(exits).toEqual([1]);
	});

	it("ignores a second signal", async () => {
		const http = step("http");
		shutdownHandleCreate({
			host,
			drainDelayMs: 1000,
			intakes: [http],
			resources: [],
		});

		emit("SIGTERM");
		await clock.advance(500);
		emit("SIGINT");
		emit("SIGTERM");
		await clock.runAll();

		expect(events.filter((event) => event === "http:start")).toHaveLength(1);
		expect(logs.info).toContainEqual(["Shutdown started on SIGTERM"]);
		expect(logs.info).not.toContainEqual(["Shutdown started on SIGINT"]);
		expect(exits).toEqual([0]);
	});

	it.each(["uncaughtException", "unhandledRejection"])(
		"on %s logs the error, shuts down with no drain delay and exits 1",
		async (event) => {
			const handle = shutdownHandleCreate({
				host,
				drainDelayMs: 5000,
				intakes: [step("http")],
				resources: [step("telemetry")],
			});
			const error = new RangeError("crash");

			emit(event, error);
			expect(handle.isShuttingDown()).toBe(true);
			expect(logs.fatal).toEqual([[{ err: error }, "Crashed, shutting down"]]);

			await clock.advance(0);
			expect(events).toEqual([
				"http:start",
				"http:done",
				"telemetry:start",
				"telemetry:done",
			]);
			expect(exits).toEqual([1]);
		},
	);

	it("keeps the cutoff and deadline on the crash path", async () => {
		shutdownHandleCreate({
			host,
			intakes: [hanging("http")],
			resources: [hanging("postgres")],
		});

		emit("uncaughtException", new Error("crash"));
		await clock.advance(20_000);
		expect(logs.warn).toEqual([["Intake http still open at the cutoff"]]);
		expect(exits).toEqual([]);

		await clock.advance(5000);
		expect(logs.error).toEqual([
			["Resource postgres still open at the deadline"],
		]);
		expect(exits).toEqual([1]);
	});

	it("logs a crash during shutdown without starting a second one, and exits 1", async () => {
		const http = step("http");
		shutdownHandleCreate({
			host,
			drainDelayMs: 1000,
			intakes: [http],
			resources: [],
		});

		emit("SIGTERM");
		const error = new Error("late");
		emit("uncaughtException", error);
		await clock.runAll();

		expect(logs.fatal).toEqual([[{ err: error }, "Crashed, shutting down"]]);
		expect(events.filter((event) => event === "http:start")).toHaveLength(1);
		expect(exits).toEqual([1]);
	});

	it("treats null as left out: 5 s drain delay, 25 s deadline", async () => {
		const handle = shutdownHandleCreate({
			host,
			deadlineMs: null,
			drainDelayMs: null,
			intakes: [hanging("http")],
			resources: [step("telemetry")],
		});

		emit("SIGTERM");
		expect(handle.isShuttingDown()).toBe(true);
		await clock.advance(4999);
		expect(events).toEqual([]);
		await clock.advance(1);
		expect(events).toEqual(["http:start"]);
		await clock.advance(15_000);
		expect(events).toEqual(["http:start", "telemetry:start", "telemetry:done"]);
		expect(exits).toEqual([1]);
	});

	it.each([
		[{ deadlineMs: 5000 }, "shutdownHandleCreate: deadlineMs"],
		[{ deadlineMs: 10_000.5 }, "shutdownHandleCreate: deadlineMs"],
		[{ deadlineMs: 2_147_483_648 }, "shutdownHandleCreate: deadlineMs"],
		[{ deadlineMs: Number.NaN }, "shutdownHandleCreate: deadlineMs"],
		[{ drainDelayMs: -1 }, "shutdownHandleCreate: drainDelayMs"],
		[{ drainDelayMs: 0.5 }, "shutdownHandleCreate: drainDelayMs"],
		[
			{ deadlineMs: 8000 },
			"shutdownHandleCreate: drainDelayMs must be under deadlineMs minus 5000 (3000), found 5000",
		],
	])(
		"throws a TypeError on %o, before owning any signal",
		(options, message) => {
			const create = () =>
				shutdownHandleCreate({ host, ...options, intakes: [], resources: [] });

			expect(create).toThrow(TypeError);
			expect(create).toThrow(message);
			expect(listeners.size).toBe(0);
		},
	);
});

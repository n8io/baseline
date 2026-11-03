import { logger } from "@n8io/baseline-logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ShutdownStep, shutdownHandle } from "../src/index.ts";

type Listener = (value?: unknown) => void;

// A fake process: listeners are captured instead of registered, exit is recorded.
let listeners: Map<string, Listener>;
let exit: ReturnType<typeof vi.fn>;
let events: string[];

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
			await new Promise((resolve) => setTimeout(resolve, ms));
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
	vi.useFakeTimers();
	listeners = new Map();
	events = [];
	vi.spyOn(process, "on").mockImplementation(((
		event: string,
		listener: Listener,
	) => {
		listeners.set(event, listener);
		return process;
	}) as typeof process.on);
	exit = vi.fn();
	vi.spyOn(process, "exit").mockImplementation(exit as never);
	vi.spyOn(logger, "info").mockImplementation(() => undefined);
	vi.spyOn(logger, "warn").mockImplementation(() => undefined);
	vi.spyOn(logger, "error").mockImplementation(() => undefined);
	vi.spyOn(logger, "fatal").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("shutdownHandle", () => {
	it("owns SIGTERM, SIGINT, uncaughtException and unhandledRejection", () => {
		shutdownHandle({ intakes: [], resources: [] });

		expect([...listeners.keys()].sort()).toEqual([
			"SIGINT",
			"SIGTERM",
			"uncaughtException",
			"unhandledRejection",
		]);
	});

	it("closes intakes together, then resources one by one in order, and exits 0", async () => {
		shutdownHandle({
			drainDelayMs: 0,
			intakes: [step("http", 300), step("live", 100)],
			resources: [step("postgres", 200), step("health", 0), step("telemetry")],
		});

		emit("SIGTERM");
		await vi.runAllTimersAsync();

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
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("reports shutting down at once and keeps serving for the drain delay", async () => {
		const handle = shutdownHandle({
			drainDelayMs: 5000,
			intakes: [step("http")],
			resources: [],
		});

		expect(handle.isShuttingDown()).toBe(false);
		emit("SIGTERM");
		expect(handle.isShuttingDown()).toBe(true);

		await vi.advanceTimersByTimeAsync(4999);
		expect(events).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		expect(events).toEqual(["http:start", "http:done"]);
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("defaults to a 5 s drain delay", async () => {
		shutdownHandle({ intakes: [step("http")], resources: [] });

		emit("SIGINT");
		await vi.advanceTimersByTimeAsync(4999);
		expect(events).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		expect(events).toEqual(["http:start", "http:done"]);
	});

	it("stops waiting for intakes 5 s before the deadline, logs each straggler and still closes the resources", async () => {
		shutdownHandle({
			intakes: [hanging("http"), step("live"), hanging("queue")],
			resources: [step("postgres"), step("telemetry")],
		});

		emit("SIGTERM");
		await vi.advanceTimersByTimeAsync(19_999);
		expect(events).toEqual([
			"http:start",
			"live:start",
			"live:done",
			"queue:start",
		]);
		expect(logger.warn).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(vi.mocked(logger.warn).mock.calls).toEqual([
			["Intake http still open at the cutoff"],
			["Intake queue still open at the cutoff"],
		]);
		expect(events.slice(4)).toEqual([
			"postgres:start",
			"postgres:done",
			"telemetry:start",
			"telemetry:done",
		]);
		expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("counts the cutoff and deadline from the signal, drain delay included", async () => {
		shutdownHandle({
			deadlineMs: 10_000,
			drainDelayMs: 3000,
			intakes: [hanging("http")],
			resources: [hanging("postgres"), step("telemetry")],
		});

		emit("SIGTERM");
		await vi.advanceTimersByTimeAsync(4999);
		expect(events).toEqual(["http:start"]);

		await vi.advanceTimersByTimeAsync(1);
		expect(events).toEqual(["http:start", "postgres:start"]);

		await vi.advanceTimersByTimeAsync(4999);
		expect(exit).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(vi.mocked(logger.error).mock.calls).toEqual([
			["Resource postgres still open at the deadline"],
			["Resource telemetry still open at the deadline"],
		]);
		expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("logs and skips a failing intake or resource, then exits 1", async () => {
		shutdownHandle({
			drainDelayMs: 0,
			intakes: [failing("http"), step("queue")],
			resources: [failing("postgres"), step("telemetry")],
		});

		emit("SIGTERM");
		await vi.runAllTimersAsync();

		expect(events).toEqual([
			"http:start",
			"queue:start",
			"queue:done",
			"postgres:start",
			"telemetry:start",
			"telemetry:done",
		]);
		expect(vi.mocked(logger.error).mock.calls).toEqual([
			[{ err: expect.any(Error) }, "Intake http failed to close"],
			[{ err: expect.any(Error) }, "Resource postgres failed to close"],
		]);
		expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("logs a step that throws instead of rejecting", async () => {
		shutdownHandle({
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
		await vi.runAllTimersAsync();

		expect(logger.error).toHaveBeenCalledWith(
			{ err: expect.any(TypeError) },
			"Resource cache failed to close",
		);
		expect(events).toEqual(["telemetry:start", "telemetry:done"]);
		expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("ignores a second signal", async () => {
		const http = step("http");
		const close = vi.spyOn(http, "close");
		shutdownHandle({ drainDelayMs: 1000, intakes: [http], resources: [] });

		emit("SIGTERM");
		await vi.advanceTimersByTimeAsync(500);
		emit("SIGINT");
		emit("SIGTERM");
		await vi.runAllTimersAsync();

		expect(close).toHaveBeenCalledOnce();
		expect(logger.info).toHaveBeenCalledWith("Shutdown started on SIGTERM");
		expect(logger.info).not.toHaveBeenCalledWith("Shutdown started on SIGINT");
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it.each(["uncaughtException", "unhandledRejection"])(
		"on %s logs the error, shuts down with no drain delay and exits 1",
		async (event) => {
			const handle = shutdownHandle({
				drainDelayMs: 5000,
				intakes: [step("http")],
				resources: [step("telemetry")],
			});
			const error = new RangeError("crash");

			emit(event, error);
			expect(handle.isShuttingDown()).toBe(true);
			expect(logger.fatal).toHaveBeenCalledExactlyOnceWith(
				{ err: error },
				"Crashed, shutting down",
			);

			await vi.advanceTimersByTimeAsync(0);
			expect(events).toEqual([
				"http:start",
				"http:done",
				"telemetry:start",
				"telemetry:done",
			]);
			expect(exit).toHaveBeenCalledExactlyOnceWith(1);
		},
	);

	it("keeps the cutoff and deadline on the crash path", async () => {
		shutdownHandle({
			intakes: [hanging("http")],
			resources: [hanging("postgres")],
		});

		emit("uncaughtException", new Error("crash"));
		await vi.advanceTimersByTimeAsync(20_000);
		expect(logger.warn).toHaveBeenCalledWith(
			"Intake http still open at the cutoff",
		);
		expect(exit).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5000);
		expect(logger.error).toHaveBeenCalledWith(
			"Resource postgres still open at the deadline",
		);
		expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("logs a crash during shutdown without starting a second one", async () => {
		const http = step("http");
		const close = vi.spyOn(http, "close");
		shutdownHandle({ drainDelayMs: 1000, intakes: [http], resources: [] });

		emit("SIGTERM");
		const error = new Error("late");
		emit("uncaughtException", error);
		await vi.runAllTimersAsync();

		expect(logger.fatal).toHaveBeenCalledWith(
			{ err: error },
			"Crashed, shutting down",
		);
		expect(close).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
	});
});

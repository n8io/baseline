import { describe, expect, it } from "vitest";
import {
	sharedConnectionSslAssert,
	sharedConnectionUrlAssert,
	sharedIntegerAssert,
	sharedKeepAlive,
	sharedTimeLimit,
	sharedTimeRace,
	sharedTimerMaxMs,
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

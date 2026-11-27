import { afterEach, describe, expect, it } from "vitest";
import { errorTrackingSend } from "./error-tracking-send.ts";

const fetchOriginal = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = fetchOriginal;
});

const fetchFake = (response: Response) => {
	const calls: { init: RequestInit; url: string }[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		calls.push({ init, url });
		return response;
	}) as typeof fetch;
	return calls;
};

const warns = () => {
	const calls: unknown[][] = [];
	return {
		calls,
		logger: { warn: ((...args: unknown[]) => calls.push(args)) as never },
	};
};

describe("errorTrackingSend", () => {
	it("posts a string body as is, with a timeout signal", async () => {
		const calls = fetchFake(new Response("{}"));

		await errorTrackingSend({
			body: "text",
			logger: warns().logger,
			url: "https://x/y",
		});

		expect(calls[0]?.url).toBe("https://x/y");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.body).toBe("text");
		expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
		expect(calls[0]?.init.signal?.aborted).toBe(false);
	});

	it("posts a copy of a byte body", async () => {
		const calls = fetchFake(new Response("{}"));
		const body = new Uint8Array([1, 2, 3]);

		await errorTrackingSend({ body, logger: warns().logger, url: "https://x" });

		const sent = calls[0]?.init.body as Uint8Array;
		expect([...sent]).toEqual([1, 2, 3]);
		expect(sent).not.toBe(body);
		expect(sent.buffer).not.toBe(body.buffer);
	});

	it("returns the status and rate-limit headers, and does not warn when ok", async () => {
		fetchFake(
			new Response(null, {
				headers: { "retry-after": "5", "x-sentry-rate-limits": "60:error" },
				status: 200,
			}),
		);
		const warn = warns();

		const out = await errorTrackingSend({
			body: "t",
			logger: warn.logger,
			url: "https://x",
		});

		expect(out).toEqual({
			headers: { "retry-after": "5", "x-sentry-rate-limits": "60:error" },
			statusCode: 200,
		});
		expect(warn.calls).toEqual([]);
	});

	it("warns with the status when refused, and returns null headers when absent", async () => {
		fetchFake(new Response("no", { status: 500 }));
		const warn = warns();

		const out = await errorTrackingSend({
			body: "t",
			logger: warn.logger,
			url: "https://x",
		});

		expect(warn.calls).toEqual([
			[{ status: 500 }, "Sentry refused an error report"],
		]);
		expect(out).toEqual({
			headers: { "retry-after": null, "x-sentry-rate-limits": null },
			statusCode: 500,
		});
	});
});

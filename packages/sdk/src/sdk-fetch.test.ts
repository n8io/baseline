import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { type SdkOptions, sdkFetchCreate } from "./sdk-fetch.ts";

type Answer = (request: IncomingMessage, response: ServerResponse) => void;

type Answered = { data: unknown; headers: Headers; status: number };

// A real local API: each request gets the next answer (the last one repeats), and the server
// keeps every request it saw.
const apiStart = async (...answers: Answer[]) => {
	const requests: IncomingMessage[] = [];
	const server = createServer((request, response) => {
		const answer = answers[Math.min(requests.length, answers.length - 1)];
		requests.push(request);
		answer?.(request, response);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		requests,
		[Symbol.asyncDispose]: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
};

const json =
	(
		status: number,
		body: unknown,
		headers: Record<string, string> = {},
	): Answer =>
	(_request, response) => {
		response
			.writeHead(status, { "content-type": "application/json", ...headers })
			.end(JSON.stringify(body));
	};

const empty =
	(status: number, headers: Record<string, string> = {}): Answer =>
	(_request, response) => {
		response.writeHead(status, headers).end();
	};

// Drops the connection without an answer: a network failure.
const dropped: Answer = (request) => {
	request.socket.destroy();
};

// Never answers, so the attempt times out.
const silent: Answer = () => undefined;

// An instance with no environments, sent to a test server through the baseUrl override.
const overrideCreate = (defaults: SdkOptions<never> = {}) =>
	sdkFetchCreate({ defaults });

const fastRetry = { retry: 2, timeoutMs: 1000, totalTimeoutMs: 5000 };

describe("sdkFetchCreate", () => {
	it("resolves the status, the parsed body and the headers, as the SDK's fetch always has", async () => {
		await using api = await apiStart(
			json(200, { id: "1" }, { "x-request-id": "r1" }),
			(_request, response) => {
				response.writeHead(201, { "content-type": "text/plain" }).end("made");
			},
			empty(204),
			json(404, { code: "FooNotFound", title: "Not found" }),
		);
		const { sdkFetch } = overrideCreate({ baseUrl: `${api.baseUrl}/` });

		const ok = await sdkFetch<Answered>("/api/v1/foos/1", { method: "GET" });
		const text = await sdkFetch<Answered>("/api/v1/foos", { method: "POST" });
		const none = await sdkFetch<Answered>("/api/v1/foos/1", {
			method: "PATCH",
		});
		const missing = await sdkFetch<Answered>("/api/v1/foos/2", {
			method: "POST",
		});

		expect(ok.status).toBe(200);
		expect(ok.data).toEqual({ id: "1" });
		expect(ok.headers.get("x-request-id")).toBe("r1");
		expect(text).toMatchObject({ data: "made", status: 201 });
		expect(none).toMatchObject({ data: undefined, status: 204 });
		expect(missing).toMatchObject({
			data: { code: "FooNotFound", title: "Not found" },
			status: 404,
		});
		expect(api.requests[0]?.url).toBe("/api/v1/foos/1");
	});

	it("sends the token as a bearer and keeps the caller's headers", async () => {
		await using api = await apiStart(empty(204));
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, token: "t1" });

		await sdkFetch("/api/v1/foos", {
			headers: { "x-extra": "yes" },
			method: "GET",
		});

		expect(api.requests[0]?.headers.authorization).toBe("Bearer t1");
		expect(api.requests[0]?.headers["x-extra"]).toBe("yes");
	});

	it("retries a GET on a 503, waiting as its Retry-After says", async () => {
		await using api = await apiStart(
			empty(503, { "retry-after": "1" }),
			json(200, { id: "1" }),
		);
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, ...fastRetry });
		const started = performance.now();

		const response = await sdkFetch<Answered>("/api/v1/foos/1", {
			method: "GET",
		});

		expect(response).toMatchObject({ data: { id: "1" }, status: 200 });
		expect(api.requests).toHaveLength(2);
		expect(performance.now() - started).toBeGreaterThanOrEqual(950);
	});

	it.each([408, 429, 500, 502, 504])(
		"retries a DELETE on a %i, then resolves the last response",
		async (status) => {
			await using api = await apiStart(
				json(status, { code: "Busy", title: "Busy" }, { "retry-after": "0" }),
			);
			const { sdkFetch } = overrideCreate({
				baseUrl: api.baseUrl,
				...fastRetry,
			});

			const response = await sdkFetch<Answered>("/api/v1/foos/1", {
				method: "DELETE",
			});

			expect(response).toMatchObject({
				data: { code: "Busy", title: "Busy" },
				status,
			});
			expect(api.requests).toHaveLength(3);
		},
	);

	it("does not retry a GET on a status that will not change, such as 404", async () => {
		await using api = await apiStart(json(404, { code: "FooNotFound" }));
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos/1", {
			method: "GET",
		});

		expect(response.status).toBe(404);
		expect(api.requests).toHaveLength(1);
	});

	it.each(["POST", "PATCH"])("never retries a %s", async (method) => {
		await using api = await apiStart(
			json(503, { code: "Busy" }, { "retry-after": "0" }),
		);
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			body: JSON.stringify({ name: "x" }),
			method,
		});

		expect(response).toMatchObject({ data: { code: "Busy" }, status: 503 });
		expect(api.requests).toHaveLength(1);
	});

	it("sends once with retry: 0", async () => {
		await using api = await apiStart(empty(503, { "retry-after": "0" }));
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, retry: 0 });

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(503);
		expect(api.requests).toHaveLength(1);
	});

	it("rejects with a TimeoutError DOMException when every attempt times out, after retrying", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			retry: 1,
			timeoutMs: 100,
		});

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(DOMException);
		expect(error).toHaveProperty("name", "TimeoutError");
		expect(api.requests).toHaveLength(2);
	});

	it("stops retrying at totalTimeoutMs", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			retry: 10,
			timeoutMs: 200,
			totalTimeoutMs: 500,
		});
		const started = performance.now();

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(DOMException);
		expect(error).toHaveProperty("name", "TimeoutError");
		expect(performance.now() - started).toBeLessThan(1500);
		expect(api.requests.length).toBeLessThan(4);
	});

	it("bounds a slow body by totalTimeoutMs too", async () => {
		await using api = await apiStart((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.write('{"id":');
		});
		const { sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			totalTimeoutMs: 300,
		});

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(DOMException);
		expect(error).toHaveProperty("name", "TimeoutError");
	});

	it.each([
		["a Retry-After", empty(503, { "retry-after": "60" })],
		["a rate-limit reset", empty(429, { "ratelimit-reset": "60" })],
	])(
		"rejects with a TimeoutError when %s is past totalTimeoutMs",
		async (_case, handler) => {
			await using api = await apiStart(handler);
			const { sdkFetch } = overrideCreate({
				baseUrl: api.baseUrl,
				totalTimeoutMs: 500,
			});

			const error = await sdkFetch<Answered>("/api/v1/foos", {
				method: "GET",
			}).catch((caught: unknown) => caught);

			expect(error).toHaveProperty("name", "TimeoutError");
			expect(api.requests).toHaveLength(1);
		},
	);

	it("rejects with the error fetch gave when the API cannot be reached", async () => {
		// Nothing listens on port 1.
		const { sdkFetch } = overrideCreate({
			baseUrl: "http://127.0.0.1:1",
			retry: 0,
		});

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(TypeError);
		expect(error).toHaveProperty("message", "fetch failed");
	});

	it("retries a GET after a network failure", async () => {
		await using api = await apiStart(dropped, json(200, { id: "1" }));
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos/1", {
			method: "GET",
		});

		expect(response).toMatchObject({ data: { id: "1" }, status: 200 });
		expect(api.requests).toHaveLength(2);
	});

	it("retries a HEAD", async () => {
		await using api = await apiStart(
			empty(503, { "retry-after": "0" }),
			empty(200),
		);
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos/1", {
			method: "HEAD",
		});

		expect(response.status).toBe(200);
		expect(api.requests).toHaveLength(2);
	});

	it("never retries a POST after a network failure or a timeout", async () => {
		await using api = await apiStart(dropped, silent);
		const { sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			retry: 2,
			timeoutMs: 200,
		});

		const failed = await sdkFetch("/api/v1/foos", { method: "POST" }).catch(
			(caught: unknown) => caught,
		);
		const timedOut = await sdkFetch("/api/v1/foos", { method: "POST" }).catch(
			(caught: unknown) => caught,
		);

		expect(failed).toBeInstanceOf(TypeError);
		expect(timedOut).toHaveProperty("name", "TimeoutError");
		expect(api.requests).toHaveLength(2);
	});

	it("waits as a Retry-After HTTP date says", async () => {
		const at = new Date(Math.ceil(Date.now() / 1000) * 1000 + 2000);
		await using api = await apiStart(
			empty(503, { "retry-after": at.toUTCString() }),
			empty(204),
		);
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(204);
		expect(api.requests).toHaveLength(2);
		expect(Date.now()).toBeGreaterThanOrEqual(at.getTime() - 50);
	});

	it("parses a retried status's body as every other status's", async () => {
		await using api = await apiStart(
			(_request, response) => {
				response
					.writeHead(503, { "content-type": "application/jsonl" })
					.end('{"a":1}');
			},
			(_request, response) => {
				response.writeHead(503, { "content-type": "text/plain" }).end("busy");
			},
			(_request, response) => {
				response
					.writeHead(503, { "content-type": "application/json" })
					.end("{");
			},
		);
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl, retry: 0 });

		const jsonl = await sdkFetch<Answered>("/a", { method: "GET" });
		const text = await sdkFetch<Answered>("/b", { method: "GET" });
		const invalid = sdkFetch("/c", { method: "GET" });

		expect(jsonl.data).toEqual({ a: 1 });
		expect(text.data).toBe("busy");
		await expect(invalid).rejects.toBeInstanceOf(SyntaxError);
	});

	it("rejects with the caller's own signal's reason", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl });
		const controller = new AbortController();
		const reason = new Error("stopped");
		setTimeout(() => controller.abort(reason), 50);

		const error = await sdkFetch("/api/v1/foos", {
			method: "GET",
			signal: controller.signal,
		}).catch((caught: unknown) => caught);

		expect(error).toBe(reason);
	});

	it('sends the header value "undefined" as it is', async () => {
		await using api = await apiStart(empty(204));
		const { sdkFetch } = overrideCreate({ baseUrl: api.baseUrl });

		await sdkFetch("/api/v1/foos", {
			headers: { "x-a": "undefined" },
			method: "GET",
		});

		expect(api.requests[0]?.headers["x-a"]).toBe("undefined");
	});

	it("rejects with no base URL when it lists no environments", async () => {
		const { sdkFetch } = sdkFetchCreate();

		await expect(sdkFetch("/api/v1/foos", { method: "GET" })).rejects.toThrow(
			"No API URL",
		);
	});

	it("lets one call override what sdkConfigure set", async () => {
		await using api = await apiStart(empty(503, { "retry-after": "0" }));
		const { sdkConfigure, sdkFetch } = overrideCreate();
		sdkConfigure({ baseUrl: "http://127.0.0.1:1", token: "configured" });
		sdkConfigure({ retry: 2 });

		await sdkFetch("/api/v1/foos", {
			baseUrl: api.baseUrl,
			method: "GET",
			retry: 0,
			token: "call",
		});

		expect(api.requests).toHaveLength(1);
		expect(api.requests[0]?.headers.authorization).toBe("Bearer call");
	});

	it("lets one call override the timeouts", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			retry: 0,
			timeoutMs: 5000,
			totalTimeoutMs: 5000,
		});
		const started = performance.now();

		const perAttempt = await sdkFetch("/a", {
			method: "GET",
			timeoutMs: 100,
		}).catch((caught: unknown) => caught);
		const total = await sdkFetch("/b", {
			method: "GET",
			totalTimeoutMs: 100,
		}).catch((caught: unknown) => caught);

		expect(perAttempt).toHaveProperty("name", "TimeoutError");
		expect(total).toHaveProperty("name", "TimeoutError");
		expect(performance.now() - started).toBeLessThan(2000);
	});

	it("keeps each instance's base URL and token its own", async () => {
		await using first = await apiStart(empty(204));
		await using second = await apiStart(empty(204));
		const one = overrideCreate({ baseUrl: first.baseUrl, token: "one" });
		const two = overrideCreate();
		two.sdkConfigure({ baseUrl: second.baseUrl, token: "two" });

		await one.sdkFetch("/api/v1/foos", { method: "GET" });
		await two.sdkFetch("/api/v1/foos", { method: "GET" });

		expect(first.requests[0]?.headers.authorization).toBe("Bearer one");
		expect(second.requests[0]?.headers.authorization).toBe("Bearer two");
	});
});

describe("sdkFetchCreate options", () => {
	it("throws a TypeError naming the function and the option on a bad retry or timeout", async () => {
		expect(() => overrideCreate({ retry: -1 })).toThrow(
			new TypeError(
				"sdkFetchCreate: defaults.retry must be a whole number, 0 or more, found -1",
			),
		);
		const { sdkConfigure, sdkFetch } = overrideCreate();
		expect(() => sdkConfigure({ timeoutMs: 0 })).toThrow(
			new TypeError(
				"sdkConfigure: timeoutMs must be a whole number from 1 to 2147483647, found 0",
			),
		);
		await expect(
			sdkFetch("/a", { method: "GET", totalTimeoutMs: Number.NaN }),
		).rejects.toThrow(
			new TypeError(
				"sdkFetch: totalTimeoutMs must be a whole number from 1 to 2147483647, found NaN",
			),
		);
	});

	it.each([
		["retry", 1.5],
		["timeoutMs", 0.5],
		["timeoutMs", 2 ** 31],
		["totalTimeoutMs", 2 ** 31],
	])("refuses %s %d, which no timer or count takes", (option, value) => {
		expect(() => overrideCreate({ [option]: value })).toThrow(
			`sdkFetchCreate: defaults.${option} must be`,
		);
	});

	it("reads a null timeout or baseUrl as the configured one", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			retry: 0,
			timeoutMs: 100,
			totalTimeoutMs: 200,
		});
		const started = performance.now();

		const timedOut = await sdkFetch("/a", {
			baseUrl: null,
			environment: null,
			method: "GET",
			timeoutMs: null,
			totalTimeoutMs: null,
		}).catch((caught: unknown) => caught);

		expect(timedOut).toHaveProperty("name", "TimeoutError");
		expect(api.requests).toHaveLength(1);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("reads null as the configured value, and a configured null as the default", async () => {
		await using api = await apiStart(empty(503), empty(503), empty(204));
		const { sdkConfigure, sdkFetch } = overrideCreate({
			baseUrl: api.baseUrl,
			retry: 0,
			token: "configured",
		});

		const sentOnce = await sdkFetch<Answered>("/a", {
			method: "GET",
			retry: null,
			token: null,
		});
		sdkConfigure({ retry: null, token: null });
		const retried = await sdkFetch<Answered>("/b", { method: "GET" });

		expect(sentOnce.status).toBe(503);
		expect(api.requests[0]?.headers.authorization).toBe("Bearer configured");
		expect(retried.status).toBe(204);
		expect(api.requests).toHaveLength(3);
		expect(api.requests[2]?.headers).not.toHaveProperty("authorization");
	});
});

describe("sdkFetchCreate environments", () => {
	it("sends a call to the environment sdkConfigure picked", async () => {
		await using api = await apiStart(empty(204));
		const { sdkConfigure, sdkFetch } = sdkFetchCreate({
			environments: { development: `${api.baseUrl}/`, production: "x" },
		});
		sdkConfigure({ environment: "development" });

		await sdkFetch("/api/v1/foos", { method: "GET" });

		expect(api.requests[0]?.url).toBe("/api/v1/foos");
	});

	it("resolves the call's baseUrl, then its environment, then the configured baseUrl, then the configured environment", async () => {
		await using callUrl = await apiStart(empty(204));
		await using callEnvironment = await apiStart(empty(204));
		await using configuredUrl = await apiStart(empty(204));
		await using configuredEnvironment = await apiStart(empty(204));
		const environments = {
			production: callEnvironment.baseUrl,
			staging: configuredEnvironment.baseUrl,
		};
		const { sdkFetch } = sdkFetchCreate({
			defaults: { baseUrl: configuredUrl.baseUrl, environment: "staging" },
			environments,
		});
		const environmentOnly = sdkFetchCreate({
			defaults: { environment: "staging" },
			environments,
		});

		await sdkFetch("/1", {
			baseUrl: callUrl.baseUrl,
			environment: "production",
			method: "GET",
		});
		await sdkFetch("/2", { environment: "production", method: "GET" });
		await sdkFetch("/3", { method: "GET" });
		await environmentOnly.sdkFetch("/4", { method: "GET" });

		expect(callUrl.requests.map((request) => request.url)).toEqual(["/1"]);
		expect(callEnvironment.requests.map((request) => request.url)).toEqual([
			"/2",
		]);
		expect(configuredUrl.requests.map((request) => request.url)).toEqual([
			"/3",
		]);
		expect(
			configuredEnvironment.requests.map((request) => request.url),
		).toEqual(["/4"]);
	});

	it("rejects with no environment and no baseUrl, naming the environments", async () => {
		const { sdkFetch } = sdkFetchCreate({
			environments: { development: "http://127.0.0.1:1", production: "x" },
		});

		await expect(sdkFetch("/api/v1/foos", { method: "GET" })).rejects.toThrow(
			"No environment: call sdkConfigure({ environment }) with one of development, production",
		);
	});

	it("rejects an unknown environment, naming the known ones", async () => {
		const { sdkFetch } = sdkFetchCreate({
			environments: { development: "http://127.0.0.1:1" },
		});
		// A plain JavaScript caller, whom the types do not stop.
		const options = { environment: "prodution" as never, method: "GET" };

		await expect(sdkFetch("/api/v1/foos", options)).rejects.toThrow(
			'Unknown environment "prodution": use one of development',
		);
	});

	it("does not compile a misspelt environment", () => {
		const environments = { production: "https://api.example.com" };
		const { sdkConfigure } = sdkFetchCreate({ environments });

		const misspelt = { environment: "prodution" } as const;

		// @ts-expect-error: "prodution" is not one of the instance's environments.
		expect(() => sdkConfigure(misspelt)).not.toThrow();
		// @ts-expect-error: nor of the defaults.
		expect(sdkFetchCreate({ defaults: misspelt, environments })).toBeDefined();
	});

	it("keeps each instance's environments its own", async () => {
		await using first = await apiStart(empty(204));
		await using second = await apiStart(empty(204));
		const one = sdkFetchCreate({
			defaults: { environment: "production" },
			environments: { production: first.baseUrl },
		});
		const two = sdkFetchCreate({
			defaults: { environment: "production" },
			environments: { production: second.baseUrl },
		});

		await one.sdkFetch("/one", { method: "GET" });
		await two.sdkFetch("/two", { method: "GET" });

		expect(first.requests.map((request) => request.url)).toEqual(["/one"]);
		expect(second.requests.map((request) => request.url)).toEqual(["/two"]);
	});
});

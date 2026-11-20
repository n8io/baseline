import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { sdkFetchCreate } from "./sdk-fetch-create.ts";

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

const fastRetry = { retry: 2, timeout: 1000, totalTimeout: 5000 };

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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: `${api.baseUrl}/` });

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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, token: "t1" });

		await sdkFetch("/api/v1/foos", {
			headers: { "x-extra": "yes" },
			method: "GET",
		});

		expect(api.requests[0]?.headers.authorization).toBe("Bearer t1");
		expect(api.requests[0]?.headers["x-extra"]).toBe("yes");
	});

	it("rejects with no base URL", async () => {
		const { sdkFetch } = sdkFetchCreate();

		await expect(sdkFetch("/api/v1/foos", { method: "GET" })).rejects.toThrow(
			"No API URL",
		);
	});

	it("retries a GET on a 503, waiting as its Retry-After says", async () => {
		await using api = await apiStart(
			empty(503, { "retry-after": "1" }),
			json(200, { id: "1" }),
		);
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, ...fastRetry });
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
			const { sdkFetch } = sdkFetchCreate({
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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, ...fastRetry });

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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			body: JSON.stringify({ name: "x" }),
			method,
		});

		expect(response).toMatchObject({ data: { code: "Busy" }, status: 503 });
		expect(api.requests).toHaveLength(1);
	});

	it("sends once with retry: 0", async () => {
		await using api = await apiStart(empty(503, { "retry-after": "0" }));
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, retry: 0 });

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(503);
		expect(api.requests).toHaveLength(1);
	});

	it("rejects with a TimeoutError DOMException when every attempt times out, after retrying", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			retry: 1,
			timeout: 100,
		});

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(DOMException);
		expect(error).toHaveProperty("name", "TimeoutError");
		expect(api.requests).toHaveLength(2);
	});

	it("stops retrying at totalTimeout", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			retry: 10,
			timeout: 200,
			totalTimeout: 500,
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

	it("bounds a slow body by totalTimeout too", async () => {
		await using api = await apiStart((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.write('{"id":');
		});
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			totalTimeout: 300,
		});

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(DOMException);
		expect(error).toHaveProperty("name", "TimeoutError");
	});

	it("resolves a 503 at once when its Retry-After is past totalTimeout", async () => {
		await using api = await apiStart(empty(503, { "retry-after": "60" }));
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			totalTimeout: 2000,
		});
		const started = performance.now();

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(503);
		expect(api.requests).toHaveLength(1);
		expect(performance.now() - started).toBeLessThan(1500);
	});

	it("rejects with the error fetch gave when the API cannot be reached", async () => {
		// Nothing listens on port 1.
		const { sdkFetch } = sdkFetchCreate({
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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, ...fastRetry });

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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos/1", {
			method: "HEAD",
		});

		expect(response.status).toBe(200);
		expect(api.requests).toHaveLength(2);
	});

	it("never retries a POST after a network failure or a timeout", async () => {
		await using api = await apiStart(dropped, silent);
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			retry: 2,
			timeout: 200,
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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, ...fastRetry });

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(204);
		expect(api.requests).toHaveLength(2);
		expect(Date.now()).toBeGreaterThanOrEqual(at.getTime() - 50);
	});

	it.each([
		["a rate-limit reset past totalTimeout", { "ratelimit-reset": "60" }, 2000],
		["a backoff past totalTimeout", {}, 200],
	])("resolves a 429 at once when %s", async (_case, headers, totalTimeout) => {
		await using api = await apiStart(empty(429, headers));
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			totalTimeout,
		});

		const response = await sdkFetch<Answered>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(429);
		expect(api.requests).toHaveLength(1);
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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, retry: 0 });

		const jsonl = await sdkFetch<Answered>("/a", { method: "GET" });
		const text = await sdkFetch<Answered>("/b", { method: "GET" });
		const invalid = sdkFetch("/c", { method: "GET" });

		expect(jsonl.data).toEqual({ a: 1 });
		expect(text.data).toBe("busy");
		await expect(invalid).rejects.toBeInstanceOf(SyntaxError);
	});

	it("rejects with the caller's own signal's reason", async () => {
		await using api = await apiStart(silent);
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl });
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
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl });

		await sdkFetch("/api/v1/foos", {
			headers: { "x-a": "undefined" },
			method: "GET",
		});

		expect(api.requests[0]?.headers["x-a"]).toBe("undefined");
	});

	it("lets one call override what sdkConfigure set", async () => {
		await using api = await apiStart(empty(503, { "retry-after": "0" }));
		const { sdkConfigure, sdkFetch } = sdkFetchCreate();
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
		const { sdkFetch } = sdkFetchCreate({
			baseUrl: api.baseUrl,
			retry: 0,
			timeout: 5000,
			totalTimeout: 5000,
		});
		const started = performance.now();

		const perAttempt = await sdkFetch("/a", {
			method: "GET",
			timeout: 100,
		}).catch((caught: unknown) => caught);
		const total = await sdkFetch("/b", {
			method: "GET",
			totalTimeout: 100,
		}).catch((caught: unknown) => caught);

		expect(perAttempt).toHaveProperty("name", "TimeoutError");
		expect(total).toHaveProperty("name", "TimeoutError");
		expect(performance.now() - started).toBeLessThan(2000);
	});

	it("keeps each instance's base URL and token its own", async () => {
		await using first = await apiStart(empty(204));
		await using second = await apiStart(empty(204));
		const one = sdkFetchCreate({ baseUrl: first.baseUrl, token: "one" });
		const two = sdkFetchCreate();
		two.sdkConfigure({ baseUrl: second.baseUrl, token: "two" });

		await one.sdkFetch("/api/v1/foos", { method: "GET" });
		await two.sdkFetch("/api/v1/foos", { method: "GET" });

		expect(first.requests[0]?.headers.authorization).toBe("Bearer one");
		expect(second.requests[0]?.headers.authorization).toBe("Bearer two");
	});
});

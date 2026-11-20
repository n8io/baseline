import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { sdkFetchCreate } from "./sdk-fetch-create.ts";

type Answer = (request: IncomingMessage, response: ServerResponse) => void;

type Response = { data: unknown; headers: Headers; status: number };

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

		const ok = await sdkFetch<Response>("/api/v1/foos/1", { method: "GET" });
		const text = await sdkFetch<Response>("/api/v1/foos", { method: "POST" });
		const none = await sdkFetch<Response>("/api/v1/foos/1", {
			method: "PATCH",
		});
		const missing = await sdkFetch<Response>("/api/v1/foos/2", {
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

		const response = await sdkFetch<Response>("/api/v1/foos/1", {
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

			const response = await sdkFetch<Response>("/api/v1/foos/1", {
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

		const response = await sdkFetch<Response>("/api/v1/foos/1", {
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

		const response = await sdkFetch<Response>("/api/v1/foos", {
			body: JSON.stringify({ name: "x" }),
			method,
		});

		expect(response).toMatchObject({ data: { code: "Busy" }, status: 503 });
		expect(api.requests).toHaveLength(1);
	});

	it("sends once with retry: 0", async () => {
		await using api = await apiStart(empty(503, { "retry-after": "0" }));
		const { sdkFetch } = sdkFetchCreate({ baseUrl: api.baseUrl, retry: 0 });

		const response = await sdkFetch<Response>("/api/v1/foos", {
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

		expect(error).toHaveProperty("name", "TimeoutError");
		expect(performance.now() - started).toBeLessThan(900);
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

		const response = await sdkFetch<Response>("/api/v1/foos", {
			method: "GET",
		});

		expect(response.status).toBe(503);
		expect(api.requests).toHaveLength(1);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("rejects with the error fetch gave when the API cannot be reached", async () => {
		const { baseUrl } = await (async () => {
			await using api = await apiStart(empty(204));
			return api;
		})();
		const { sdkFetch } = sdkFetchCreate({ baseUrl, retry: 0 });

		const error = await sdkFetch("/api/v1/foos", { method: "GET" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(TypeError);
		expect(error).toHaveProperty("message", "fetch failed");
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

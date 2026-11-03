import { Agent, createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { httpServerClose } from "../src/index.ts";

const agents: Agent[] = [];

afterEach(() => {
	for (const agent of agents.splice(0)) agent.destroy();
});

// A server whose /slow response takes 200 ms, with a keep-alive timeout far longer than the test.
// `slowArrived` resolves once /slow reaches the handler, so a test never closes before it;
// each finished response is recorded in `events`.
const serverListen = async (
	events: string[],
): Promise<{ server: Server; slowArrived: Promise<void> }> => {
	const slow = Promise.withResolvers<void>();
	const server = createServer((req, res) => {
		if (req.url === "/slow") {
			slow.resolve();
		}
		res.on("finish", () => events.push(`${req.url} finished`));
		setTimeout(() => res.end("done"), req.url === "/slow" ? 200 : 0);
	});
	server.keepAliveTimeout = 60_000;
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, slowArrived: slow.promise };
};

const get = (server: Server, path: string): Promise<string> => {
	const agent = new Agent({ keepAlive: true });
	agents.push(agent);
	const { port } = server.address() as AddressInfo;
	return new Promise((resolve, reject) => {
		request({ agent, host: "127.0.0.1", path, port }, (res) => {
			let body = "";
			res.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			res.on("end", () => resolve(body));
		})
			.on("error", reject)
			.end();
	});
};

describe("httpServerClose", () => {
	it("waits for a running request, then closes its keep-alive socket once it goes idle", async () => {
		const events: string[] = [];
		const { server, slowArrived } = await serverListen(events);
		const response = get(server, "/slow");
		await slowArrived;

		const started = performance.now();
		const closed = httpServerClose(server).then(() => events.push("closed"));
		expect(await response).toBe("done");
		await closed;

		expect(events).toStrictEqual(["/slow finished", "closed"]);
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(server.listening).toBe(false);
	});

	it("rejects when the server is not running", async () => {
		const server = createServer();

		await expect(httpServerClose(server)).rejects.toMatchObject({
			code: "ERR_SERVER_NOT_RUNNING",
		});
	});
});

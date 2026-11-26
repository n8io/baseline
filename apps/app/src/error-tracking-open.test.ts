import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loggerCreate } from "@n8io/baseline-logger";
import { describe, expect, it, onTestFinished } from "vitest";
import { errorTrackingOpen } from "./error-tracking-open.ts";
import type { ShutdownSteps } from "./shutdown-step-add.ts";

const logger = loggerCreate();

const steps: ShutdownSteps = { intakes: [], resources: [] };

// The logger writes JSON lines to process.stdout; the errors this file logs on purpose would
// otherwise show up as error-level lines in a green run. Returns what the logger wrote.
const stdoutCapture = (): string[] => {
	const lines: string[] = [];
	const { write } = process.stdout;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	onTestFinished(() => {
		process.stdout.write = write;
	});
	return lines;
};

// Stands in for Sentry's ingestion: keeps each request body and answers 200.
const ingestOpen = async () => {
	const bodies: string[] = [];
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			bodies.push(Buffer.concat(chunks).toString());
			response.setHeader("content-type", "application/json");
			response.end("{}");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	onTestFinished(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	const { port } = server.address() as AddressInfo;
	return { bodies, dsn: `http://public@127.0.0.1:${port}/1` };
};

describe("errorTrackingOpen", () => {
	it("reports nothing, with nothing to close, when there is no DSN", () => {
		expect(errorTrackingOpen({ environment: "test", steps })).toEqual(steps);
	});

	it("reports each error the logger logs until shutdown, then closes", async () => {
		const written = stdoutCapture();
		const { bodies, dsn } = await ingestOpen();
		// .env.test sets LOG_LEVEL silent, and a level that is off reaches no listener.
		const level = logger.level;
		const writable = logger as { level: string };
		writable.level = "error";
		onTestFinished(() => {
			writable.level = level;
		});
		const opened = errorTrackingOpen({ dsn, environment: "test", steps });
		class QueueFailure extends Error {}

		logger.error({ err: new QueueFailure("boom") }, "Queue error");

		expect(opened.resources.map((s) => s.name)).toEqual(["error tracking"]);
		await opened.resources[0]?.close();
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toContain("QueueFailure");

		expect(written.join("")).toContain("Queue error");
	});
});

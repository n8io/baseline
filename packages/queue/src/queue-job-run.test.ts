import { logger } from "@n8io/baseline-logger";
import { err, ok } from "@n8io/baseline-result";
import { metrics, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queueJobRun } from "./queue-job-run.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("queueJobRun", () => {
	it("completes on ok", async () => {
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 0 },
				work: async () => ok(1),
			}),
		).resolves.toBeUndefined();
	});

	it("completes on err and marks the span with error.type", async () => {
		const setAttribute = vi.fn();
		vi.spyOn(trace, "getActiveSpan").mockReturnValue({
			setAttribute,
		} as unknown as ReturnType<typeof trace.getActiveSpan>);

		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 0 },
				work: async () => err({ type: "FooNotFound" }),
			}),
		).resolves.toBeUndefined();
		expect(setAttribute).toHaveBeenCalledWith("error.type", "FooNotFound");
	});

	it("rethrows, and counts a dead letter only on the last attempt", async () => {
		const add = vi.fn();
		vi.spyOn(metrics, "getMeter").mockReturnValue({
			createCounter: () => ({ add }),
		} as unknown as ReturnType<typeof metrics.getMeter>);
		const boom = async (): Promise<never> => {
			throw new Error("boom");
		};

		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 3 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(add).not.toHaveBeenCalled();
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 4 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(add).toHaveBeenCalledWith(1, {
			"messaging.destination.name": "billing.foo-created",
		});
	});
	it("logs that the key is blocked when a Consumer's job fails for good", async () => {
		const error = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const boom = async (): Promise<never> => {
			throw new Error("boom");
		};

		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { key: "foo_1", retryCount: 4 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(error).toHaveBeenLastCalledWith(
			expect.objectContaining({ attempt: 5, key: "foo_1" }),
			"Job failed; copied to dead letter, and its key is blocked until released",
		);
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { key: "foo_1", retryCount: 0 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(error).toHaveBeenLastCalledWith(
			expect.not.objectContaining({ key: "foo_1" }),
			"Job failed; will retry",
		);
	});
});

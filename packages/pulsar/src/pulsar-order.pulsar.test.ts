import { randomUUID } from "node:crypto";
import { type Consumer, queueConsumerCreate } from "@n8io/baseline-queue";
import { ok } from "@n8io/baseline-result";
import { describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { pulsarCreate, pulsarEventsCreate } from "./index.ts";

const fooChanged = z.object({ fooId: z.string(), version: z.number() });
type FooChanged = z.infer<typeof fooChanged>;

const options = {
	retryDelayMs: 20,
	serviceUrl: inject("pulsarUrl"),
	token: inject("pulsarToken"),
};

describe("Events of one Event key", () => {
	it("run in order, once per Consumer, on several workers with retries", async () => {
		const eventName = `foo.changed-${randomUUID()}`;
		const queueNames = [
			`billing.foo-changed-${randomUUID()}`,
			`shipping.foo-changed-${randomUUID()}`,
		];
		const keys = Array.from({ length: 40 }, (_, index) => `foo_${index}`);
		const versions = Array.from({ length: 10 }, (_, index) => index);
		// Per Consumer and key, the versions in the order they finished.
		const finished = new Map<string, number[]>();
		const failedOnce = new Set<string>();
		const workersUsed = new Set<number>();
		const consumersCreate = (worker: number): Consumer[] =>
			queueNames.map((queueName) =>
				queueConsumerCreate({
					eventName,
					queueName,
					run: async ({ fooId, version }: FooChanged) => {
						const lane = `${queueName} ${fooId}`;
						// Every third Event fails its first attempt, so later ones could pass it.
						if (version % 3 === 1 && !failedOnce.has(`${lane} ${version}`)) {
							failedOnce.add(`${lane} ${version}`);
							throw new Error("Invoice service down");
						}
						await new Promise((resolve) => setTimeout(resolve, 2));
						workersUsed.add(worker);
						finished.set(lane, [...(finished.get(lane) ?? []), version]);
						return ok(undefined);
					},
					schema: fooChanged,
				}),
			);
		await using publisher = pulsarCreate(options);
		await using worker0 = pulsarCreate(options);
		await using worker1 = pulsarCreate(options);
		await using worker2 = pulsarCreate(options);
		for (const [index, worker] of [worker0, worker1, worker2].entries()) {
			await pulsarEventsCreate(worker).consumersStart(consumersCreate(index));
		}
		for (const version of versions) {
			const events = pulsarEventsCreate(publisher).publisherCreate<
				Record<string, FooChanged>
			>({ query: () => Promise.reject(new Error("not used")) });
			for (const fooId of keys) {
				await events.publish({
					data: { fooId, version },
					key: fooId,
					name: eventName,
				});
			}
			await events.committed();
		}
		const expected = new Map(
			queueNames.flatMap((queueName) =>
				keys.map((fooId) => [`${queueName} ${fooId}`, versions] as const),
			),
		);
		await vi.waitFor(() => expect(finished).toEqual(expected), {
			interval: 250,
			timeout: 50_000,
		});
		expect(workersUsed.size).toBeGreaterThan(1);
	});
});

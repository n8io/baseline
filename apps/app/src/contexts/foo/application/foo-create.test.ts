import type { Actor } from "@n8io/baseline-authn";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../clock.ts";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../use-cases.ts";
import { FooNameTakenError } from "../domain/errors.ts";
import { FooListInput } from "../domain/foo.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };
const now = new Date("2026-06-01T00:00:00.000Z");
const connections = await connectionsOpen({ role: "publisher" });

describe("fooCreate", () => {
	it("creates a foo owned by the actor, and a get reads it back", async () => {
		const { useCases } = contextsCreate({
			...connections,
			clock: clockMemoryCreate(now),
		}).fooContext;

		const result = await useCases.fooCreate(actor, { name: "alpha" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual({
			archivedAt: null,
			createdAt: now,
			createdBy: "u1",
			id: expect.stringMatching(/^foo_/),
			name: "alpha",
			updatedAt: now,
		});
		expect(await useCases.fooGet(actor, { fooId: result.value.id })).toEqual({
			ok: true,
			value: result.value,
		});
	});

	it("returns FooNameTakenError for a taken name and adds no second foo", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		await useCases.fooCreate(actor, { name: "alpha" });

		const result = await useCases.fooCreate(actor, { name: "alpha" });

		expect(result).toEqual(err(expect.any(FooNameTakenError)));
		expect(
			await useCases.fooList(actor, FooListInput.parse({ count: true })),
		).toMatchObject({ ok: true, value: { total: 1 } });
	});
});

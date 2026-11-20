import type { AnalyticsEvent } from "@n8io/baseline-analytics";
import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";

// The analytics events the use cases track after commit; the analytics piece owns this file.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

// The context on an analytics connection that keeps what it was given.
const setup = () => {
	const tracked: AnalyticsEvent[] = [];
	const { useCases } = contextsCreate({
		...connections,
		analytics: {
			...connections.analytics,
			track: (event) => {
				tracked.push(event);
			},
		},
	}).fooContext;
	return { tracked, useCases };
};

describe("foo analytics", () => {
	it("tracks foo.created with the Actor's id", async () => {
		const { tracked, useCases } = setup();

		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;

		expect(tracked).toEqual([
			{
				actorId: owner.id,
				name: "foo.created",
				properties: { fooId: created.value.id },
			},
		]);
	});

	it("tracks nothing when the create fails", async () => {
		const { tracked, useCases } = setup();
		await useCases.fooCreate(owner, { name: "alpha" });
		tracked.length = 0;

		await useCases.fooCreate(owner, { name: "alpha" });

		expect(tracked).toEqual([]);
	});
});

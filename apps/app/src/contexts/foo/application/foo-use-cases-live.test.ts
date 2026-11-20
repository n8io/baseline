import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import type { LiveHub } from "@n8io/baseline-live";
import type { RedisClient } from "@n8io/baseline-redis";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";
import { liveHubOpen } from "../../../live-hub-open.ts";

// The live updates each use case sends after commit; the live piece owns this file.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

// The context on a live hub that keeps what it was given to send.
const setup = async () => {
	const sent: { channel: string; update: Parameters<LiveHub["send"]>[1] }[] =
		[];
	const { useCases } = contextsCreate({
		...connections,
		liveHub: {
			...connections.liveHub,
			send: async (channel, update) => {
				sent.push({ channel, update });
			},
		},
	}).fooContext;
	const created = await useCases.fooCreate(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	await useCases.fooCreate(owner, { name: "beta" });
	return { foo: created.value, sent, useCases };
};

describe("foo live updates", () => {
	it("sends foo.updated after a rename and foo.deleted after a delete", async () => {
		const { foo, sent, useCases } = await setup();

		await useCases.fooUpdate(owner, { fooId: foo.id, name: "gamma" });
		await useCases.fooDelete(owner, { fooId: foo.id });

		expect(sent).toEqual([
			{ channel: "foo", update: { id: foo.id, type: "foo.updated" } },
			{ channel: "foo", update: { id: foo.id, type: "foo.deleted" } },
		]);
	});

	it("sends nothing when the change fails", async () => {
		const { foo, sent, useCases } = await setup();

		await useCases.fooUpdate(stranger, { fooId: foo.id, name: "gamma" });
		await useCases.fooUpdate(owner, { fooId: foo.id, name: "beta" });
		await useCases.fooUpdate(owner, { fooId: idCreate("foo"), name: "gamma" });
		await useCases.fooDelete(stranger, { fooId: foo.id });
		await useCases.fooDelete(owner, { fooId: idCreate("foo") });

		expect(sent).toEqual([]);
	});

	it("still reports the change when the hub cannot send", async () => {
		const publish = async (): Promise<never> => {
			throw new Error("Redis is down");
		};
		const { useCases } = contextsCreate({
			...connections,
			liveHub: liveHubOpen({
				redis: { publish } as unknown as RedisClient,
				steps: [],
			}),
		}).fooContext;
		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;
		const foo = created.value;

		expect(
			await useCases.fooUpdate(owner, { fooId: foo.id, name: "gamma" }),
		).toMatchObject({ ok: true, value: { name: "gamma" } });
		expect(await useCases.fooDelete(owner, { fooId: foo.id })).toEqual({
			ok: true,
			value: undefined,
		});
	});
});

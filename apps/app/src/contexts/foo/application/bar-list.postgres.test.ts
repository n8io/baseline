import type { Actor } from "@n8io/baseline-authn";
import type { Id } from "@n8io/baseline-id";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../../../../test/integration/integration-database.ts";
import { type Connections, connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";
import { bar } from "../adapters/outbound/bar-table.ts";

// A Bar never outlives its Foo. No read through the interface can show a deleted foo's bars, so
// this one looks in the table.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };
let connections: Connections;
let drop: () => Promise<void>;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	connections = await connectionsOpen({
		role: "publisher",
		urls: { cache: "memory://", database: database.databaseUrl },
	});
});

afterAll(async () => {
	for (const step of [...connections.intakes, ...connections.resources]) {
		await step.close();
	}
	await drop();
});

const barsCount = async (fooId: Id<"foo">): Promise<number> => {
	if (connections.database === "memory") throw new Error("needs Postgres");
	const rows = await drizzle({ client: connections.database })
		.select()
		.from(bar)
		.where(eq(bar.fooId, fooId));
	return rows.length;
};

describe("a foo's bars on Postgres", () => {
	it("go when their foo is deleted, and other foos' bars stay", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const [gone, kept] = await Promise.all(
			["gone", "kept"].map(async (name) => {
				const created = await useCases.fooCreate(owner, { name });
				if (!created.ok) throw created.error;
				await useCases.barCreate(owner, {
					fooId: created.value.id,
					text: name,
				});
				return created.value.id;
			}),
		);
		if (!gone || !kept) throw new Error("setup");

		expect(await useCases.fooDelete(owner, { fooId: gone })).toEqual({
			ok: true,
			value: undefined,
		});

		expect(await barsCount(gone)).toBe(0);
		expect(await barsCount(kept)).toBe(1);
	});
});

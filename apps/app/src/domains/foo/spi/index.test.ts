import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { ENV } from "#env";
import { connectionsOpen } from "../../../connections.ts";
import { fooPortsCreate } from "./index.ts";

describe("fooPortsCreate", () => {
	it("builds memory ports for a memory database", async () => {
		const ports = fooPortsCreate(await connectionsOpen(ENV, "publisher"));
		const now = new Date();
		const foo = {
			archivedAt: null,
			createdAt: now,
			createdBy: "u1",
			id: idCreate("foo"),
			name: "alpha",
			updatedAt: now,
		};
		await ports.fooTransaction(async ({ fooRepository }) => {
			await fooRepository.insert(foo);
			return ok(undefined);
		});
		expect(await ports.fooReadRepository.findById(foo.id)).toEqual(foo);
	});
});

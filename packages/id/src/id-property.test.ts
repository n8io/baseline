import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { idCreate, idFromUuid, idPatternCreate, idToUuid } from "./id.ts";

// A snake_case prefix the way idCreate accepts it: 1 to 63 characters, letters and inner underscores.
const prefixArbitrary = fc
	.stringMatching(/^[a-z]([a-z_]{0,61}[a-z])?$/)
	.filter((prefix) => prefix.length <= 63);

const uuidArbitrary = fc.uuid();

describe("id properties", () => {
	it("idFromUuid and idToUuid are inverses for any prefix and UUID", () => {
		fc.assert(
			fc.property(prefixArbitrary, uuidArbitrary, (prefix, uuid) => {
				const id = idFromUuid(prefix, uuid);

				expect(idToUuid(id)).toBe(uuid.toLowerCase());
				expect(idFromUuid(prefix, idToUuid(id))).toBe(id);
			}),
		);
	});

	it("an id keeps its prefix and matches only that prefix's pattern", () => {
		fc.assert(
			fc.property(
				prefixArbitrary,
				prefixArbitrary,
				uuidArbitrary,
				(prefix, other, uuid) => {
					const id = idFromUuid(prefix, uuid);

					expect(id.startsWith(`${prefix}_`)).toBe(true);
					expect(idPatternCreate(prefix).test(id)).toBe(true);
					// Another prefix matches only when it is this one.
					expect(idPatternCreate(other).test(id)).toBe(other === prefix);
				},
			),
		);
	});

	it("ids of one prefix sort like their UUIDs, so UUIDv7 ids sort by time", () => {
		const order = (a: string, b: string): number =>
			a < b ? -1 : a > b ? 1 : 0;

		fc.assert(
			fc.property(prefixArbitrary, uuidArbitrary, uuidArbitrary, (p, a, b) => {
				expect(order(idFromUuid(p, a), idFromUuid(p, b))).toBe(
					order(a.toLowerCase(), b.toLowerCase()),
				);
			}),
		);
	});

	it("a created id of any prefix round-trips through its UUID", () => {
		fc.assert(
			fc.property(prefixArbitrary, (prefix) => {
				const id = idCreate(prefix);

				expect(idFromUuid(prefix, idToUuid(id))).toBe(id);
			}),
			{ numRuns: 200 },
		);
	});
});

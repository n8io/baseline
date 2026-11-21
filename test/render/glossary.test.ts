import { describe, expect, it } from "vitest";
import { glossaryContextMapRowAdd } from "./glossary.ts";

describe("glossaryContextMapRowAdd", () => {
	const map = [
		"# Context map",
		"",
		"## Contexts",
		"",
		"| Context | Language |",
		"| ------- | -------- |",
		"",
		"## Relationships",
		"",
		"| Downstream | Upstream | Through |",
		"| ---------- | -------- | ------- |",
		"",
	].join("\n");

	it("adds the row at the end of the Contexts table", () => {
		const once = glossaryContextMapRowAdd({
			context: "billing",
			map,
		});
		const twice = glossaryContextMapRowAdd({
			context: "crm",
			map: once,
		});

		expect(twice.split("\n").slice(4, 9)).toEqual([
			"| Context | Language |",
			"| ------- | -------- |",
			"| `billing` | [src/contexts/billing/CONTEXT.md](src/contexts/billing/CONTEXT.md) |",
			"| `crm` | [src/contexts/crm/CONTEXT.md](src/contexts/crm/CONTEXT.md) |",
			"",
		]);
	});

	it("throws on a map with no Contexts table", () => {
		expect(() =>
			glossaryContextMapRowAdd({
				context: "billing",
				map: "# Map\n",
			}),
		).toThrow("no ## Contexts");
	});
});

import { describe, expect, it } from "vitest";
import { glossaryContextMapRowAdd } from "./glossary.ts";

describe("glossaryContextMapRowAdd", () => {
	const map = [
		"# Context map",
		"",
		"## Contexts",
		"",
		"| Context | Subdomain | Language |",
		"| ------- | --------- | -------- |",
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
			subdomain: "core",
		});
		const twice = glossaryContextMapRowAdd({
			context: "crm",
			map: once,
			subdomain: "generic",
		});

		expect(twice.split("\n").slice(4, 9)).toEqual([
			"| Context | Subdomain | Language |",
			"| ------- | --------- | -------- |",
			"| `billing` | core | [src/contexts/billing/CONTEXT.md](src/contexts/billing/CONTEXT.md) |",
			"| `crm` | generic | [src/contexts/crm/CONTEXT.md](src/contexts/crm/CONTEXT.md) |",
			"",
		]);
	});

	it("throws on a map with no Contexts table", () => {
		expect(() =>
			glossaryContextMapRowAdd({
				context: "billing",
				map: "# Map\n",
				subdomain: "core",
			}),
		).toThrow("no ## Contexts");
	});
});

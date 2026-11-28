import { type AxeResults, source as axeSource } from "axe-core";
import type { Page } from "playwright";

// The axe check every browser test shares: run axe-core in the page and return its serious and
// critical violations as `id (impact)` lines. An empty list passes. Axe must have run, so a page
// where it checked no rule throws instead of passing with nothing.
type Axe = { run: () => Promise<AxeResults> };

export const axeBlocking = async (page: Page): Promise<string[]> => {
	await page.evaluate(axeSource);
	const { passes, violations } = await page.evaluate(() =>
		(globalThis as unknown as { axe: Axe }).axe.run(),
	);
	if (passes.length === 0) throw new Error("axe checked no rule");
	return violations
		.filter(({ impact }) => impact === "serious" || impact === "critical")
		.map(({ id, impact }) => `${id} (${impact})`);
};

import { describe, expect, it } from "vitest";
import { pieceCheckPlan } from "./piece-check.ts";

const all = new Set([
	"@n8io/baseline-analytics",
	"@n8io/baseline-cache",
	"@n8io/baseline-error-tracking",
	"@n8io/baseline-live",
	"@n8io/baseline-queue",
	"@n8io/baseline-redis",
	"react-router",
]);

const plan = (options: Partial<Parameters<typeof pieceCheckPlan>[0]> = {}) =>
	pieceCheckPlan({
		installed: all,
		kept: [],
		refusal: () => undefined,
		requested: [],
		...options,
	});

describe("pieceCheckPlan", () => {
	it("checks every installed piece, redis after the cache and live updates", () => {
		expect(plan().checks).toEqual([
			{ first: [], piece: "analytics" },
			{ first: [], piece: "cache" },
			{ first: [], piece: "error-tracking" },
			{ first: [], piece: "live" },
			{ first: [], piece: "queue" },
			{ first: ["cache", "live"], piece: "redis" },
			{ first: [], piece: "ui" },
		]);
	});

	it("leaves out a piece the Project kept, and says why", () => {
		const kept = plan({ kept: ["analytics", "live"] });
		expect(kept.checks.map((c) => c.piece)).toEqual([
			"cache",
			"error-tracking",
			"queue",
			"ui",
		]);
		expect(kept.notes).toContain(
			"analytics: kept (piecesKept in .template.json)",
		);
		expect(kept.notes).toContain("redis: skipped, live is kept and runs on it");
	});

	it("leaves out a piece that is not installed, and takes redis alone once the others are gone", () => {
		const installed = new Set(["@n8io/baseline-redis"]);
		expect(plan({ installed }).checks).toEqual([{ first: [], piece: "redis" }]);
		expect(plan({ installed }).notes).toContain("ui: not installed");
	});

	it("skips the queue while a Consumer needs it", () => {
		const blocked = plan({
			refusal: (piece) =>
				piece === "queue" ? "Remove your Consumers first." : undefined,
		});
		expect(blocked.checks.map((c) => c.piece)).not.toContain("queue");
		expect(blocked.notes).toContain(
			"queue: skipped, Remove your Consumers first.",
		);
	});

	it("does not take the refusal to remove redis first as a reason to skip it", () => {
		const refusal = (piece: string) =>
			piece === "redis"
				? "Remove the cache and live updates first."
				: undefined;
		expect(plan({ refusal }).checks).toContainEqual({
			first: ["cache", "live"],
			piece: "redis",
		});
		const installed = new Set(["@n8io/baseline-redis", "@n8io/baseline-live"]);
		expect(plan({ installed, refusal }).checks).toEqual(
			[
				{ first: ["live"], piece: "redis" },
				{ first: [], piece: "live" },
			].reverse(),
		);
	});

	it("checks only the pieces asked for", () => {
		expect(plan({ requested: ["cache"] }).checks).toEqual([
			{ first: [], piece: "cache" },
		]);
	});
});

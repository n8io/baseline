import { describe, expect, it } from "vitest";
import {
	eachConcurrently,
	jobEndRead,
	pieceCheckFailureReport,
	pieceCheckPlanCreate,
	pieceCheckRun,
} from "./piece-check.ts";

const all = new Set([
	"@n8io/baseline-analytics",
	"@n8io/baseline-cache",
	"@n8io/baseline-error-tracking",
	"@n8io/baseline-live",
	"@n8io/baseline-queue",
	"@n8io/baseline-redis",
	"react-router",
	"swagger-ui-dist",
]);

const plan = (
	options: Partial<Parameters<typeof pieceCheckPlanCreate>[0]> = {},
) =>
	pieceCheckPlanCreate({
		installed: all,
		kept: [],
		refusal: () => undefined,
		requested: [],
		...options,
	});

describe("pieceCheckPlanCreate", () => {
	it("checks every installed piece, redis after the cache and live updates", () => {
		expect(plan().checks).toEqual([
			{ first: [], piece: "analytics" },
			{ first: [], piece: "api-reference" },
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
			"api-reference",
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

	it("skips the queue while an Event handler needs it", () => {
		const blocked = plan({
			refusal: (piece) =>
				piece === "queue" ? "Remove your Event handlers first." : undefined,
		});
		expect(blocked.checks.map((c) => c.piece)).not.toContain("queue");
		expect(blocked.notes).toContain(
			"queue: skipped, Remove your Event handlers first.",
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

	it("checks the cli by its folder, and the sdk after it", () => {
		const installed = new Set(["orval", "clients/cli"]);
		expect(plan({ installed }).checks).toEqual([
			{ first: [], piece: "cli" },
			{ first: ["cli"], piece: "sdk" },
		]);
		expect(plan({ installed: new Set(["orval"]) }).checks).toEqual([
			{ first: [], piece: "sdk" },
		]);
	});

	it("checks only the pieces asked for", () => {
		expect(plan({ requested: ["cache"] }).checks).toEqual([
			{ first: [], piece: "cache" },
		]);
	});
});

describe("eachConcurrently", () => {
	it("runs every item, at most limit at once, starting them in order", async () => {
		const started: number[] = [];
		let running = 0;
		let most = 0;
		await eachConcurrently({
			each: async (item: number) => {
				started.push(item);
				running += 1;
				most = Math.max(most, running);
				await new Promise((resolve) => setTimeout(resolve, 5));
				running -= 1;
			},
			items: [1, 2, 3, 4, 5],
			limit: 2,
		});
		expect(started).toEqual([1, 2, 3, 4, 5]);
		expect(most).toBe(2);
	});
});

describe("pieceCheckRun", () => {
	const removed: string[] = [];
	const tools = ({ failing }: { failing?: string | undefined }) => ({
		pieceRemove: (_tree: string, name: string) => {
			removed.push(name);
			return undefined;
		},
		pnpmRun: (_tree: string, args: string[]) =>
			args[0] === failing
				? { ok: false, output: `ERR_PNPM_TARBALL_HTTP_STATUS on ${args[0]}` }
				: { ok: true, output: "" },
	});
	const check = (failing?: string) =>
		pieceCheckFailureReport(
			"cache",
			pieceCheckRun({
				first: [],
				piece: "cache",
				tools: tools({ failing }),
				tree: "/tree",
			}),
		);

	it("reports a failed install as not checked, exits 4 and blames no piece", () => {
		removed.length = 0;
		const report = check("install");
		expect(report?.code).toBe(4);
		expect(report?.text).toContain("cache could not be checked");
		expect(report?.text).toContain("ERR_PNPM_TARBALL_HTTP_STATUS");
		expect(report?.text).toContain("no piece is to blame");
		expect(report?.text).not.toContain("fails at");
		expect(removed).toEqual([]);
	});

	it.each(["pnpm remove", "pnpm add"])(
		"reports a failed %s during the removal as not checked, exits 4 and blames no piece",
		(command) => {
			const report = pieceCheckFailureReport(
				"cache",
				pieceCheckRun({
					first: [],
					piece: "cache",
					tools: {
						...tools({}),
						pieceRemove: () => ({
							files: [],
							output: "ERR_PNPM_FETCH_404 from the registry",
							packageManager: command,
						}),
					},
					tree: "/tree",
				}),
			);
			expect(report?.code).toBe(4);
			expect(report?.text).toContain("cache could not be checked");
			expect(report?.text).toContain(`${command} failed`);
			expect(report?.text).toContain("ERR_PNPM_FETCH_404");
			expect(report?.text).not.toContain("fails at");
		},
	);

	it("blames the piece, with exit 3, when its removal fails on the Project's code", () => {
		const report = pieceCheckFailureReport(
			"cache",
			pieceCheckRun({
				first: [],
				piece: "cache",
				tools: {
					...tools({}),
					pieceRemove: () => ({
						files: ["src/a.ts"],
						output: "src/a.ts(1,1) error",
					}),
				},
				tree: "/tree",
			}),
		);
		expect(report?.code).toBe(3);
		expect(report?.text).toContain("fails at pnpm piece-remove cache");
	});

	it("blames the piece, with exit 3, when its test fails after a good install", () => {
		const report = check("test");
		expect(report?.code).toBe(3);
		expect(report?.text).toContain("piece-check: cache fails at pnpm test.");
	});

	it("reports nothing when every step passes", () => {
		expect(check()).toBeUndefined();
	});
});

describe("jobEndRead", () => {
	const end = (code: number | null) =>
		jobEndRead({ code, output: " out ", signal: null });

	it("maps each exit code to its outcome", () => {
		expect(end(0).outcome).toBe("passed");
		expect(end(3).outcome).toBe("failed");
		expect(end(4)).toEqual({ outcome: "unchecked", output: "out" });
		expect(end(1).outcome).toBe("crashed");
		expect(end(null).outcome).toBe("crashed");
	});
});

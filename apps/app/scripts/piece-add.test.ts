import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	pieceAdd,
	pieceDocsAdd,
	pieceManifestAdd,
	pieceMatrixAdd,
	pieceNameProblem,
} from "./piece-add.ts";
import { pieceNames } from "./pieces.ts";

// The files this test reads from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["../docs/agents/pieces.md"], { query: "?raw" });

const appRoot = resolve(import.meta.dirname, "..");
const manifestAnchor =
	"\t// pnpm piece-add inserts new entries above this line.\n";

const manifestFixture = `export const pieceManifest = {\n\tcache: {\n\t\tpackages: ["@n8io/baseline-cache"],\n\t\tpaths: [],\n\t},\n${manifestAnchor}} as const;\n`;
const workflowFixture = `jobs:\n  piece:\n    name: piece (\${{ matrix.piece }})\n    strategy:\n      matrix:\n        piece:\n          - cache\n  pieces:\n    needs: piece\n`;
const docsFixture = "# Pieces\n\n## Cache\n\n`pnpm piece-remove cache`\n";

const root = mkdtempSync(join(tmpdir(), "piece-add-"));
// Each case gets its own folder under the one temporary root, removed at the end.
const caseDirectory = (name: string) => {
	const directory = join(root, name);
	mkdirSync(join(directory, "scripts"), { recursive: true });
	mkdirSync(join(directory, "docs/agents"), { recursive: true });
	mkdirSync(join(directory, "src"), { recursive: true });
	mkdirSync(join(directory, ".github/workflows"), { recursive: true });
	writeFileSync(join(directory, "scripts/piece-manifest.ts"), manifestFixture);
	writeFileSync(
		join(directory, ".github/workflows/app-ci.yml"),
		workflowFixture,
	);
	writeFileSync(join(directory, "docs/agents/pieces.md"), docsFixture);
	return directory;
};

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe("piece-add", () => {
	it("accepts lowercase hyphenated names and refuses the rest", () => {
		expect(pieceNameProblem("error-tracking")).toBeUndefined();
		expect(pieceNameProblem("Cache")).toBeDefined();
		expect(pieceNameProblem("double--hyphen")).toBeDefined();
		expect(pieceNameProblem("")).toBeDefined();
	});

	it("adds the entry above the manifest's anchor, quoting a hyphenated key", () => {
		const added = pieceManifestAdd(manifestFixture, "error-tracking") ?? "";
		expect(added).toContain(
			'\t"error-tracking": {\n\t\tpackages: ["@n8io/baseline-error-tracking"],',
		);
		expect(added.indexOf('"error-tracking"')).toBeLessThan(
			added.indexOf(manifestAnchor),
		);
		expect(pieceManifestAdd("no anchor here", "live")).toBeUndefined();
	});

	it("adds a row last in the piece matrix and keeps the rows before it", () => {
		const added = pieceMatrixAdd(workflowFixture, "live") ?? "";
		expect(added).toContain("          - cache\n          - live\n  pieces:");
		expect(pieceMatrixAdd("jobs: {}\n", "live")).toBeUndefined();
	});

	it("appends a docs section that names the piece's remove command", () => {
		const added = pieceDocsAdd(docsFixture, "live");
		expect(added).toContain("## Live\n\n`pnpm piece-remove live`");
	});

	it("names every piece of the manifest in docs/agents/pieces.md", () => {
		const docs = readFileSync(join(appRoot, "docs/agents/pieces.md"), "utf8");
		const missing = pieceNames.filter(
			(name) => !docs.includes(`\`pnpm piece-remove ${name}\``),
		);
		expect(missing).toEqual([]);
	});

	it("writes the manifest, matrix, docs and scaffold for a new piece", () => {
		const directory = caseDirectory("writes");
		const result = pieceAdd({ directory, name: "live" });
		expect("written" in result).toBe(true);
		expect(
			readFileSync(join(directory, "scripts/piece-manifest.ts"), "utf8"),
		).toContain('\tlive: {\n\t\tpackages: ["@n8io/baseline-live"],');
		expect(readFileSync(join(directory, "src/live-open.ts"), "utf8")).toContain(
			"`pnpm piece-remove live`",
		);
	});

	it("refuses a piece that already exists and leaves the tree as it was", () => {
		const directory = caseDirectory("exists");
		const before = readFileSync(
			join(directory, "scripts/piece-manifest.ts"),
			"utf8",
		);
		const result = pieceAdd({ directory, name: "cache" });
		expect(result).toEqual({ problem: "cache is already a piece" });
		expect(
			readFileSync(join(directory, "scripts/piece-manifest.ts"), "utf8"),
		).toBe(before);
	});

	it("refuses a manifest with no anchor before writing any file", () => {
		const directory = caseDirectory("anchor");
		writeFileSync(
			join(directory, "scripts/piece-manifest.ts"),
			"export const x = 1;\n",
		);
		const result = pieceAdd({ directory, name: "live" });
		expect(result).toEqual({
			problem: "scripts/piece-manifest.ts has no entry anchor to add above",
		});
		expect(readFileSync(join(directory, "docs/agents/pieces.md"), "utf8")).toBe(
			docsFixture,
		);
	});
});

// pnpm piece-add <name>: adds a Piece to the stack in one step. It appends the Piece's entry to
// piece-manifest.ts, its row to the piece matrix of app-ci.yml, a section to docs/agents/pieces.md,
// and its own file, src/<name>-open.ts, where the Piece's code goes. It never commits. The Piece's
// package, code and docs are still to write; docs/agents/pieces.md ("Adding a piece") says how.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argsParse, argsUsageFail } from "./args.ts";

export const pieceAddUsage = `Usage: pnpm piece-add <name>

  <name>      lowercase words joined by hyphens, such as error-tracking
  -h, --help  this help`;

// A name is kebab-case, so it is a valid key, file name and package suffix.
export const pieceNameProblem = (name: string): string | undefined =>
	/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name) && name.length <= 30
		? undefined
		: `${name} is not a piece name: use lowercase words joined by hyphens, such as error-tracking`;

// The key as the manifest writes it: bare when it is an identifier, quoted when it has a hyphen.
const pieceKey = (name: string): string =>
	/^[a-z]+$/.test(name) ? name : JSON.stringify(name);

// Whether the manifest already has an entry for the Piece.
export const pieceHasEntry = (manifest: string, name: string): boolean =>
	new RegExp(`^\\t(?:${name}|"${name}"): \\{$`, "m").test(manifest);

const manifestAnchor =
	"\t// pnpm piece-add inserts new entries above this line.\n";

// The manifest with the Piece's entry above its anchor; undefined when the anchor is missing.
export const pieceManifestAdd = (text: string, name: string) =>
	text.includes(manifestAnchor)
		? text.replace(manifestAnchor, () =>
				[
					`\t${pieceKey(name)}: {`,
					`\t\tpackages: ["@n8io/baseline-${name}"],`,
					`\t\tpaths: ["src/${name}-open.ts"],`,
					`\t\tsrcFiles: /-use-cases-${name}\\.test\\.ts$/,`,
					"\t},",
					manifestAnchor,
				].join("\n"),
			)
		: undefined;

// The piece matrix of app-ci.yml with the Piece as its last row, the order the manifest keeps.
const matrixRows =
	/^( {2}piece:\n[\s\S]*?matrix:\n {8}piece:\n)((?: {10}- .+\n)+)/m;
export const pieceMatrixAdd = (workflow: string, name: string) =>
	matrixRows.test(workflow)
		? workflow.replace(matrixRows, `$1$2          - ${name}\n`)
		: undefined;

// The Piece's section in docs/agents/pieces.md, with the command that names it and a line to fill in.
export const pieceDocsAdd = (text: string, name: string) => {
	const title = name.replace(/-/g, " ");
	return `${text}\n## ${title.charAt(0).toUpperCase()}${title.slice(1)}\n\n\`pnpm piece-remove ${name}\`\n\n_Not described yet: say what the piece is, what removing it deletes and how to add it back._\n`;
};

// The Piece's own file: removing the Piece deletes it whole, so its code goes here or in blocks.
export const pieceScaffold = (name: string) =>
	`// The ${name} piece's own file: \`pnpm piece-remove ${name}\` deletes it whole. Its code goes here,\n// or in \`// piece-start: ${name}\` blocks where it shares a file (docs/agents/pieces.md).\nexport {};\n`;

// Where app-ci.yml is: beside the app in a Project, at the repository root in the Template.
const workflowPath = (directory: string) =>
	[
		join(directory, ".github/workflows/app-ci.yml"),
		join(directory, "../../.github/workflows/app-ci.yml"),
	].find(existsSync);

// Adds the Piece to the manifest, the matrix, the docs and the own file under `directory` (the app,
// apps/app in the Template). Every edit is computed before any file is written, so a refusal
// leaves the tree as it was. Returns the problem, or the files written.
export const pieceAdd = ({
	directory,
	name,
}: {
	directory: string;
	name: string;
}): { problem: string } | { written: string[] } => {
	const nameBad = pieceNameProblem(name);
	if (nameBad !== undefined) return { problem: nameBad };
	const manifestFile = join(directory, "scripts/piece-manifest.ts");
	const docsFile = join(directory, "docs/agents/pieces.md");
	const scaffoldFile = join(directory, `src/${name}-open.ts`);
	const workflowFile = workflowPath(directory);
	if (workflowFile === undefined) {
		return {
			problem:
				"no .github/workflows/app-ci.yml found beside the app or at the repository root",
		};
	}
	const manifest = readFileSync(manifestFile, "utf8");
	if (pieceHasEntry(manifest, name)) {
		return { problem: `${name} is already a piece` };
	}
	const manifestEdited = pieceManifestAdd(manifest, name);
	const workflow = readFileSync(workflowFile, "utf8");
	const workflowEdited = pieceMatrixAdd(workflow, name);
	if (manifestEdited === undefined) {
		return {
			problem: "scripts/piece-manifest.ts has no entry anchor to add above",
		};
	}
	if (workflowEdited === undefined) {
		return { problem: "app-ci.yml has no piece matrix to add a row to" };
	}
	if (existsSync(scaffoldFile)) {
		return { problem: `src/${name}-open.ts already exists` };
	}
	const docs = pieceDocsAdd(readFileSync(docsFile, "utf8"), name);
	const writes = [
		[manifestFile, manifestEdited],
		[workflowFile, workflowEdited],
		[docsFile, docs],
		[scaffoldFile, pieceScaffold(name)],
	] as const;
	for (const [file, text] of writes) writeFileSync(file, text);
	return { written: writes.map(([file]) => file) };
};

const main = () => {
	const parsed = argsParse({
		allowPositionals: true,
		options: {},
		usage: pieceAddUsage,
	});
	if (parsed === undefined) return;
	const [name] = parsed.positionals;
	if (name === undefined || parsed.positionals.length !== 1) {
		argsUsageFail(pieceAddUsage);
		return;
	}
	const result = pieceAdd({ directory: process.cwd(), name });
	if ("problem" in result) {
		console.error(`piece-add: ${result.problem}`);
		process.exitCode = 1;
		return;
	}
	console.log(
		[
			`Added ${name}: ${result.written.join(", ")}.`,
			`Next: write its code in src/${name}-open.ts, add its package, and fill in its section in docs/agents/pieces.md.`,
			`Then pnpm check, pnpm test and git add -A && git commit -m "Add ${name}".`,
		].join("\n"),
	);
};

if (import.meta.main) main();

import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateFilesCreate } from "../apps/app/scripts/aggregate-create.ts";
import { contextFilesCreate } from "../apps/app/scripts/context-create.ts";
import {
	filesRead,
	filesWrite,
	templateFilesRender,
} from "../apps/app/scripts/template-render.ts";

// apps/app/docs/agents/bridges.md quotes the render test's invoice-line context. Each ts block
// starts with `// <path>` and must appear in that file: in the second-domain fixture's files when
// the fixture adds the file, in one hunk of its wiring.patch when it changes a generated one, or
// else in what `context-create invoice-line --reads customer` and then
// `aggregate-create invoice-line invoice-line --bare` write. Whitespace and
// trailing commas are ignored: Biome reformats both the quoted block and the generated code.
const doc = new URL("../apps/app/docs/agents/bridges.md", import.meta.url);
const fixture = new URL("render/second-domain/", import.meta.url);

// The new side of each hunk wiring.patch makes to path, hunks apart.
const patchedRead = (path: string): string[] => {
	const patch = readFileSync(new URL("wiring.patch", fixture), "utf8");
	const hunks: string[] = [];
	let inFile = false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("diff --git ")) {
			inFile = line === `diff --git a/${path} b/${path}`;
		} else if (inFile && line.startsWith("@@")) {
			hunks.push("");
		} else if (inFile && hunks.length > 0 && /^[ +]/.test(line)) {
			hunks[hunks.length - 1] += `${line.slice(1)}\n`;
		}
	}
	return hunks;
};

const formatDrop = (text: string): string =>
	text.replaceAll(/\s+/g, "").replaceAll(/,(?=[)\]}>])/g, "");

const app = fileURLToPath(new URL("../apps/app/", import.meta.url));
// A rendered Project with a customer context to read, then the two commands, in a scratch folder.
const generated = (() => {
	using folder = mkdtempDisposableSync(join(tmpdir(), "bridges-doc-"));
	const project = folder.path;
	const templateFull = filesRead(app);
	filesWrite(
		project,
		templateFilesRender(templateFull, { description: "d", name: "n" }),
	);
	mkdirSync(join(project, "src/contexts/customer/application"), {
		recursive: true,
	});
	writeFileSync(
		join(project, "src/contexts/customer/application/ports.ts"),
		"",
	);
	const shell = contextFilesCreate({
		appDirectory: project,
		context: "invoice-line",
		reads: ["customer"],
		templateFull,
	});
	filesWrite(project, shell);
	const aggregate = aggregateFilesCreate({
		aggregate: { kebab: "invoice-line", plural: "invoice-lines" },
		appDirectory: project,
		context: "invoice-line",
		parts: [],
		templateFull,
	});
	return [
		...shell.filter((f) => !aggregate.some((a) => a.path === f.path)),
		...aggregate,
	];
})();

const sourcesRead = (path: string): string[] => {
	const added = new URL(`files/${path}`, fixture);
	if (existsSync(added)) return [readFileSync(added, "utf8")];
	return [
		...patchedRead(path),
		...generated.filter((f) => f.path === path).map((f) => f.text),
	];
};

const bridgesDocBlocksRead = (text: string) =>
	[...text.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(([, body = ""]) => {
		const [first = "", ...rest] = body.split("\n");
		return {
			path: /^\/\/ (src\/\S+\.ts)$/.exec(first)?.[1],
			code: rest.join("\n"),
		};
	});

describe("docs/agents/bridges.md", () => {
	const blocks = bridgesDocBlocksRead(readFileSync(doc, "utf8"));

	it("quotes code in every ts block", () => {
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks.filter((b) => b.path === undefined)).toEqual([]);
	});

	it.each(blocks.map((b) => [b.path, b.code]))(
		"quotes %s as the fixture has it",
		(path, code) => {
			expect(code.trim()).not.toBe("");
			const sources = sourcesRead(path ?? "");
			expect(sources.length).toBeGreaterThan(0);
			expect(
				sources.some((source) => formatDrop(source).includes(formatDrop(code))),
			).toBe(true);
		},
	);
});

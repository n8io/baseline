import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type ArchitectureFile,
	architectureFileCreate,
	architectureRules,
	architectureSrcRead,
} from "./architecture/rules.ts";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const samplesDir = new URL("./architecture/", import.meta.url);
const ruleIds = Object.keys(architectureRules);

const files = await architectureSrcRead(appRoot);

// A sample: `// A1: <rule>`, `// expect: <part of the message>`, then `// @file <path>` sections.
const samplesRead = () =>
	Promise.all(
		readdirSync(samplesDir)
			.filter((name) => name.endsWith(".txt"))
			.sort()
			.map(async (name) => {
				const text = readFileSync(new URL(name, samplesDir), "utf8");
				const rule = /^\/\/ (A\d+):/m.exec(text)?.[1] ?? "";
				const expected = /^\/\/ expect: (.+)$/m.exec(text)?.[1] ?? "";
				const sections = text.split(/^\/\/ @file (\S+)\n/m).slice(1);
				const sampleFiles: Promise<ArchitectureFile>[] = [];
				for (let i = 0; i < sections.length; i += 2) {
					sampleFiles.push(
						architectureFileCreate(sections[i] ?? "", sections[i + 1] ?? ""),
					);
				}
				return { expected, files: await Promise.all(sampleFiles), name, rule };
			}),
	);
const samples = await samplesRead();

describe("architecture", () => {
	it("reads every source file and its imports", () => {
		const server = files.find((f) => f.path === "src/server.ts");
		expect(files.length).toBeGreaterThan(50);
		expect(server?.imports.map((imp) => imp.target)).toContain(
			"src/domains/foo/index.ts",
		);
		expect(
			files.find((f) => f.path === "src/ui/routes/foo-detail.tsx")?.imports,
		).toContainEqual(
			expect.objectContaining({ target: "src/domains/foo/index.ts" }),
		);
	});

	it.each(ruleIds)("src/ keeps rule %s", (rule) => {
		expect(architectureRules[rule]?.(files)).toEqual([]);
	});

	it("has one failing sample per rule", () => {
		expect(samples.map((s) => s.rule).sort()).toEqual([...ruleIds].sort());
	});

	// V23: the regex checks of A11 and A14 also pass the corrected sample.
	it.each([
		[
			"a11-bridge-writes.txt",
			"\tensure: (name) => u.bazCreate(actor, { name }),\n",
			"",
		],
		["a14-column-without-consumer.txt", '"baz.created"', '"baz.deleted"'],
	])("%s passes once fixed", async (name, from, to) => {
		const sample = samples.find((s) => s.name === name);
		const fixed = await Promise.all(
			(sample?.files ?? []).map((f) =>
				architectureFileCreate(f.path, f.source.replace(from, to)),
			),
		);
		expect(fixed.map((f) => f.source).join("")).not.toContain(from);
		expect(architectureRules[sample?.rule ?? ""]?.(fixed)).toEqual([]);
	});

	it.each(samples)("$name fails $rule", ({ expected, files, rule }) => {
		expect(expected).not.toBe("");
		expect(architectureRules[rule]?.(files)).toContainEqual(
			expect.stringContaining(expected),
		);
	});
});

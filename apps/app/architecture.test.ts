import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type ArchitectureFile,
	architectureFileCreate,
	architectureRules,
	architectureSrcRead,
} from "./architecture-test-rules.ts";

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const samplesDir = new URL("./architecture-test-samples/", import.meta.url);
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
		// Domain-generic, so it holds after template-render removes the example domain.
		const server = files.find((f) => f.path === "src/server.ts");
		const root = files.find((f) => f.path === "src/ui/root.tsx");
		expect(files.length).toBeGreaterThan(10);
		expect(server?.imports.map((imp) => imp.target)).toContain("src/env.ts");
		expect(root?.imports.map((imp) => imp.specifier)).toContain("react-router");
	});

	it.each(ruleIds)("src/ keeps rule %s", (rule) => {
		expect(architectureRules[rule]?.(files)).toEqual([]);
	});

	it("has a failing sample for every rule", () => {
		expect([...new Set(samples.map((s) => s.rule))].sort()).toEqual(
			[...ruleIds].sort(),
		);
	});

	// The regex checks of A11 and A14 also pass the corrected sample.
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

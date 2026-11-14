import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A Project copies the Template's tests, so they show the way: memory adapters are the fakes, a
// collaborator is real, and output is captured. No module mocks, spies, call-recording functions or
// fake clocks.
const appRoot = fileURLToPath(new URL("../apps/app/", import.meta.url));

const banned =
	/\bvi\.(?!waitFor\b|waitUntil\b)\w+|import\s*\{[^}]*\bvi\b[^}]*\}\s*from\s*"vitest"/;

const mocksFind = (source: string): string[] =>
	source
		.split("\n")
		.map((text, index) => ({ line: index + 1, text }))
		.filter(({ text }) => banned.test(text))
		.map(({ line, text }) => `line ${line}: ${text.trim()}`);

const sourcesList = (): string[] =>
	readdirSync(appRoot, { recursive: true })
		.map((name) => String(name).split(path.sep).join("/"))
		.filter(
			(name) =>
				/\.tsx?$/.test(name) &&
				!/(^|\/)(node_modules|build|\.react-router)\//.test(name),
		);

describe("Template tests", () => {
	it("use no mocks, spies or fake timers", () => {
		const files = sourcesList();
		expect(files.length).toBeGreaterThan(100);
		const found = files.flatMap((name) =>
			mocksFind(readFileSync(path.join(appRoot, name), "utf8")).map(
				(hit) => `apps/app/${name}: ${hit}`,
			),
		);
		expect(found).toEqual([]);
	});

	it.each([
		'vi.mock("./a.ts", () => ({}));',
		"const f = vi.fn();",
		'vi.spyOn(console, "log");',
		"vi.useFakeTimers();",
		'vi.stubGlobal("window", {});',
		"vi.setSystemTime(new Date());",
		"vi.hoisted(() => ({}));",
		'vi.doMock("varlock/env", () => ({}));',
	])("flags %s", (line) => {
		expect(mocksFind(line)).toHaveLength(1);
	});
});

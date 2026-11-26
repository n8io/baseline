// Writes `engines.node` (">=<major>") from .node-version into the root package.json, every
// Package and the Template, and copies it to the Template's own apps/app/.node-version (which
// Projects inherit), so a Node bump is one edit to .node-version plus
// `pnpm node-version-sync`. test/node-version.test.ts fails when any of them drifts.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const nodeMajorRead = (root: string): string => {
	const major = readFileSync(join(root, ".node-version"), "utf8")
		.trim()
		.replace(/^v/, "")
		.split(".")[0];
	if (!major || !/^\d+$/.test(major)) {
		throw new Error(".node-version must start with a Node major, such as 26");
	}
	return major;
};

export const templateNodeVersion = "apps/app/.node-version";

export const manifestsList = (root: string): string[] => [
	"package.json",
	...readdirSync(join(root, "packages")).map(
		(dir) => `packages/${dir}/package.json`,
	),
	"apps/app/package.json",
];

const enginesPattern = /("engines":\s*\{\s*"node":\s*)"[^"]*"/;

export const enginesRead = (text: string): string | undefined =>
	(JSON.parse(text) as { engines?: { node?: string } }).engines?.node;

export const enginesRewrite = (text: string, major: string): string =>
	text.replace(enginesPattern, `$1">=${major}"`);

export const nodeVersionSync = (root: string): void => {
	const major = nodeMajorRead(root);
	const source = readFileSync(join(root, ".node-version"), "utf8");
	if (readFileSync(join(root, templateNodeVersion), "utf8") !== source) {
		writeFileSync(join(root, templateNodeVersion), source);
	}
	for (const file of manifestsList(root)) {
		const path = join(root, file);
		const text = readFileSync(path, "utf8");
		if (!enginesPattern.test(text)) {
			throw new Error(`${file} has no engines.node to write`);
		}
		const next = enginesRewrite(text, major);
		if (next !== text) writeFileSync(path, next);
	}
};

if (import.meta.main) {
	nodeVersionSync(resolve(import.meta.dirname, ".."));
}

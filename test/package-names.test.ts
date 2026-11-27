import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs/agents/packages.md: a duration is milliseconds and its name ends in `Ms`; an exported
// predicate names its subject first, then `Is`, `Has` or `Can`.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

type Source = { path: string; text: string };

const sourcesRead = (): Source[] =>
	readdirSync(path.join(repoRoot, "packages"), { recursive: true })
		.map((name) => `packages/${String(name).split(path.sep).join("/")}`)
		.filter(
			(name) =>
				/\/src\/[^/]+\.ts$/.test(name) &&
				!/\.test\.ts$|\.d\.ts$|-test-|\.contract\.ts$/.test(name) &&
				!name.includes("node_modules"),
		)
		.map((name) => ({
			path: name,
			text: readFileSync(path.join(repoRoot, name), "utf8"),
		}));

// A duration-shaped property that is a number and does not end in `Ms`.
const durationWord =
	/(timeout|deadline|ttl|interval|delay|duration|seconds|millis)/i;
const propertyPattern =
	/^\s*(?:readonly )?(\w+)\??:\s*(?:number|\(\) => number)\b/gm;

// Names a vendor or a wire format fixes: Node's server options, OpenTelemetry's batch options,
// pg-boss's `expireInSeconds` and OAuth's `expires_in` seconds. Each is one bounded exception.
const vendorNames = new Set([
	"accessTtlSeconds",
	"exportIntervalMillis",
	"exportTimeoutMillis",
	"expireInSeconds",
	"expiresInSeconds",
	"headersTimeout",
	"keepAliveTimeout",
	"scheduledDelayMillis",
]);

const durationMisses = (source: Source): string[] =>
	[...source.text.matchAll(propertyPattern)]
		.map((match) => match[1] ?? "")
		.filter(
			(name) =>
				durationWord.test(name) &&
				!name.endsWith("Ms") &&
				!vendorNames.has(name),
		)
		.map((name) => `${source.path}: ${name}`);

const predicateMisses = (source: Source): string[] =>
	[
		...source.text.matchAll(
			/^export (?:async )?(?:function|const) ((?:is|has|can)[A-Z]\w*)/gm,
		),
	].map((match) => `${source.path}: ${match[1] ?? ""}`);

describe("Package names", () => {
	const sources = sourcesRead();

	it("reads the Packages' sources", () => {
		expect(sources.length).toBeGreaterThan(100);
	});

	it("ends every duration name in Ms", () => {
		expect(sources.flatMap(durationMisses)).toEqual([]);
	});

	it("names an exported predicate subject first, never isX, hasX or canX", () => {
		expect(sources.flatMap(predicateMisses)).toEqual([]);
	});

	it("catches a duration without the suffix", () => {
		const source = { path: "x.ts", text: "type A = {\n\ttimeout: number;\n}" };

		expect(durationMisses(source)).toEqual(["x.ts: timeout"]);
	});

	it("catches a predicate that starts with is", () => {
		const source = { path: "x.ts", text: "export const isAlive = () => true;" };

		expect(predicateMisses(source)).toEqual(["x.ts: isAlive"]);
	});
});

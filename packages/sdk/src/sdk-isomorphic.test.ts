import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const sourceDirectory = fileURLToPath(new URL(".", import.meta.url));

// Tests and their fixtures run in Node only; everything else ships to browsers too.
const sourcesShipped = readdirSync(sourceDirectory, { recursive: true })
	.map(String)
	.filter(
		(path) =>
			path.endsWith(".ts") &&
			!path.endsWith(".test.ts") &&
			!path.includes("-test-"),
	);

it("ships source with no node: import and no Node global, so it runs in a browser", () => {
	expect(sourcesShipped).toContain("sdk-fetch-create.ts");
	for (const path of sourcesShipped) {
		const source = readFileSync(`${sourceDirectory}${path}`, "utf8");
		expect(source, path).not.toMatch(/from\s+["']node:|import\(\s*["']node:/);
		expect(source, path).not.toMatch(/\b(process|Buffer|__dirname|require)\b/);
	}
});

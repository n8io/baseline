// Reads and runs no file of the app
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientsFilesRead, clientsVersionNext } from "./clients-release.ts";

// Writes an sdk and a cli folder as clients/ holds them, or as a published version unpacks.
const clientsWrite = ({
	directory,
	fetch,
	scope,
	sdk,
}: {
	directory: string;
	fetch: string;
	scope: string;
	sdk: string;
}): void => {
	const name = `${scope}shop-sdk`;
	const files: Record<string, string> = {
		"cli/cli.ts": 'import * as sdk from "shop-sdk";\n',
		"cli/package.json": JSON.stringify({
			dependencies: {
				"@n8io/baseline-cli": "^1.0.0",
				"shop-sdk": scope === "" ? "workspace:*" : "npm:@acme/shop-sdk@1.4.2",
			},
			name: `${scope}shop-cli`,
		}),
		"sdk/openapi.json": `{"info":{"version":"1"},"paths":${sdk}}`,
		"sdk/package.json": JSON.stringify({ name }),
		"sdk/sdk-fetch.ts": fetch,
		"sdk/sdk.ts": `export const shopGet = () => ${sdk};\n`,
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(directory, path, ".."), { recursive: true });
		writeFileSync(join(directory, path), text);
	}
};

const versionNext = (change: {
	fetch?: string;
	sdk?: string;
}): string | undefined => {
	using folder = mkdtempDisposableSync(join(tmpdir(), "clients-release-"));
	const published = join(folder.path, "published");
	const current = join(folder.path, "clients");
	clientsWrite({
		directory: published,
		fetch: "fetch",
		scope: "@acme/",
		sdk: "{}",
	});
	clientsWrite({
		directory: current,
		fetch: change.fetch ?? "fetch",
		scope: "",
		sdk: change.sdk ?? "{}",
	});
	return clientsVersionNext({
		current: clientsFilesRead(current),
		major: 1,
		published: { files: clientsFilesRead(published), version: "1.4.2" },
	});
};

describe("clientsVersionNext", () => {
	it("publishes nothing when the clients match the published version", () => {
		expect(versionNext({})).toBeUndefined();
	});

	it("publishes the next minor when the generated SDK changed", () => {
		expect(versionNext({ sdk: '{"/shops":{}}' })).toBe("1.5.0");
	});

	it("publishes the next patch when only hand-written code changed", () => {
		expect(versionNext({ fetch: "fetch with a retry" })).toBe("1.4.3");
	});

	it("publishes <major>.0.0 when nothing is published yet", () => {
		using folder = mkdtempDisposableSync(join(tmpdir(), "clients-release-"));
		clientsWrite({
			directory: folder.path,
			fetch: "fetch",
			scope: "",
			sdk: "{}",
		});
		expect(
			clientsVersionNext({ current: clientsFilesRead(folder.path), major: 1 }),
		).toBe("1.0.0");
	});
});

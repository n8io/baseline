// Reads and runs no file of the app
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	clientsFilesRead,
	clientsManifestPublish,
	clientsVersionNext,
	jsonImportsTyped,
} from "./clients-release.ts";

// Writes an sdk and a cli folder as clients/ holds them, or as a published version unpacks.
const clientsWrite = ({
	cliRange,
	directory,
	environments = '{"production":"https://api.shop.test"}',
	fetch,
	scope,
	sdk,
}: {
	cliRange?: string;
	directory: string;
	environments?: string;
	fetch: string;
	scope: string;
	sdk: string;
}): void => {
	const name = `${scope}shop-sdk`;
	const files: Record<string, string> = {
		"cli/cli.ts": 'import * as sdk from "shop-sdk";\n',
		"cli/package.json": JSON.stringify({
			dependencies: {
				"@n8io/baseline-cli": cliRange ?? "^1.0.0",
				"shop-sdk": scope === "" ? "workspace:*" : "npm:@acme/shop-sdk@1.4.2",
			},
			name: `${scope}shop-cli`,
		}),
		"sdk/openapi.json": `{"info":{"version":"1"},"paths":${sdk}}`,
		"sdk/package.json": JSON.stringify({ name }),
		"sdk/sdk-fetch.ts": fetch,
		"sdk/sdk.ts": `export const shopGet = () => ${sdk};\n`,
	};
	// clients/environments.json is published inside the SDK.
	files[scope === "" ? "environments.json" : "sdk/environments.json"] =
		environments;
	// A published version also holds the build, which never counts.
	if (scope !== "") files["sdk/dist/sdk.js"] = "export const shopGet = 1;\n";
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(directory, path, ".."), { recursive: true });
		writeFileSync(join(directory, path), text);
	}
};

const versionNext = (change: {
	cliRange?: string;
	environments?: string;
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
		cliRange: change.cliRange ?? "^1.0.0",
		directory: current,
		...(change.environments && { environments: change.environments }),
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

	it("publishes the next minor when an environment changed", () => {
		expect(
			versionNext({ environments: '{"production":"https://api2.shop.test"}' }),
		).toBe("1.5.0");
	});

	it("publishes the next patch when only hand-written code changed", () => {
		expect(versionNext({ fetch: "fetch with a retry" })).toBe("1.4.3");
	});

	it("publishes the next patch when only a dependency changed", () => {
		expect(versionNext({ cliRange: "^1.1.0" })).toBe("1.4.3");
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

describe("clientsManifestPublish", () => {
	it("scopes, versions and points the package at its build, with the SDK as an npm alias", () => {
		const manifest = clientsManifestPublish({
			client: "cli",
			manifest: {
				bin: { shop: "./cli.ts" },
				dependencies: {
					"@n8io/baseline-cli": "^1.0.0",
					"shop-sdk": "workspace:*",
				},
				exports: { ".": "./index.ts", "./openapi.json": "./openapi.json" },
				name: "shop-cli",
				private: true,
				scripts: { start: "node cli.ts" },
			},
			scope: "@acme",
			sdk: "shop-sdk",
			version: "1.5.0",
		});
		expect(manifest).toMatchObject({
			bin: { shop: "dist/cli.js" },
			dependencies: {
				"@n8io/baseline-cli": "^1.0.0",
				"shop-sdk": "npm:@acme/shop-sdk@1.5.0",
			},
			name: "@acme/shop-cli",
			version: "1.5.0",
		});
		expect(manifest).not.toHaveProperty("private");
		expect(manifest).not.toHaveProperty("scripts");
		// Conditions are read in order, so types must come first.
		expect(JSON.stringify(manifest.exports)).toBe(
			'{".":{"types":"./dist/index.d.ts","default":"./dist/index.js"},"./openapi.json":"./openapi.json"}',
		);
	});
});

describe("jsonImportsTyped", () => {
	it("gives a declaration's JSON imports the attribute nodenext needs", () => {
		expect(
			jsonImportsTyped(
				'import environments from "../environments.json";\nimport { a } from "./a.js";\n',
			),
		).toBe(
			'import environments from "../environments.json" with { type: "json" };\nimport { a } from "./a.js";\n',
		);
	});
});

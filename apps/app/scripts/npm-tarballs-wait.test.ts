import { once } from "node:events";
import { mkdtempDisposableSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { npmTarballsWait } from "./npm-tarballs-wait.ts";

// A registry on localhost that answers each path 404 `misses` times (or `status` when set), then 200.
const registryServe = async (
	paths: Record<string, number>,
	status?: number | null,
) => {
	const asked: string[] = [];
	const server = createServer((request, response) => {
		const path = request.url ?? "";
		asked.push(path);
		const misses = paths[path] ?? Number.POSITIVE_INFINITY;
		const served = asked.filter((p) => p === path).length > misses;
		response.writeHead(status ?? (served ? 200 : 404)).end();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		asked,
		registry: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		[Symbol.asyncDispose]: async () => {
			server.close();
			await once(server, "close");
		},
	};
};

const projectCreate = (names: string[]) => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "npm-tarballs-wait-"));
	writeFileSync(
		join(folder.path, "pnpm-lock.yaml"),
		`packages:\n\n${names.map((n) => `  '@n8io/${n}':\n    resolution: {}\n`).join("\n")}\n  react@19.0.0:\n    resolution: {}\n`,
	);
	return folder;
};

describe("npmTarballsWait", () => {
	it("waits for a just-published tarball that answers 404, then returns", async () => {
		await using fake = await registryServe({
			"/@n8io/baseline-http/-/baseline-http-2.1.0.tgz": 2,
		});
		using folder = projectCreate(["baseline-http@2.1.0"]);
		const lines: string[] = [];
		await npmTarballsWait({
			directory: folder.path,
			intervalMs: 5,
			log: (line) => lines.push(line),
			registry: fake.registry,
		});

		expect(fake.asked).toHaveLength(3);
		expect(lines).toHaveLength(2);
	});

	it("names the tarball npm still answers 404 for and calls it a registry delay", async () => {
		await using fake = await registryServe({});
		using folder = projectCreate(["baseline-id@1.0.0"]);
		await expect(
			npmTarballsWait({
				directory: folder.path,
				intervalMs: 5,
				log: () => {},
				registry: fake.registry,
				timeoutMs: 30,
			}),
		).rejects.toThrow(
			/baseline-id-1\.0\.0\.tgz.*registry delay after a fresh publish, not a broken Project/,
		);
	});

	it("asks a served tarball once, asks only @n8io/baseline-* and adds no delay", async () => {
		await using fake = await registryServe({
			"/@n8io/baseline-id/-/baseline-id-1.0.0.tgz": 0,
		});
		using folder = projectCreate(["baseline-id@1.0.0"]);
		await npmTarballsWait({
			directory: folder.path,
			log: () => {
				throw new Error("must not log");
			},
			registry: fake.registry,
		});

		expect(fake.asked).toEqual(["/@n8io/baseline-id/-/baseline-id-1.0.0.tgz"]);
	});

	it("leaves any answer but 404 to the install", async () => {
		await using fake = await registryServe({}, 500);
		using folder = projectCreate(["baseline-id@1.0.0"]);
		await npmTarballsWait({
			directory: folder.path,
			log: () => {
				throw new Error("must not wait");
			},
			registry: fake.registry,
		});

		expect(fake.asked).toHaveLength(1);
	});
});

// pnpm api-check: fails when this change breaks the API a client already uses. It builds the
// OpenAPI document of origin/main and of the working tree, the way CI's `check` job does, and runs
// `oasdiff breaking --fail-on ERR` on the pair, with a removed operationId or tag raised to an error. docs/agents/api.md says what oasdiff allows.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { argsParse } from "./args.ts";
import { gitRun, processRun } from "./process-run.ts";

const installLine =
	"oasdiff is not on PATH. Install it with `brew install oasdiff`, or download v1.35.0 from https://github.com/oasdiff/oasdiff/releases.";

// oasdiff scores a renamed or removed operationId or tag as info, but SDK methods and CLI
// commands are named after them, so a client breaks: raise both to errors.
const severityLevels = "api-operation-id-removed err\napi-tag-removed err\n";

// A base document built before boolean query parameters were documented as booleans lists each
// one as `type: string` with a boolean `default` (Zod's stringbool). The server took only "true"
// or "false" then too, so the base is read as the boolean it was. Delete this once every Project is
// on app@13.0.0 or later.
export const queryBooleansTyped = (document: unknown): unknown => {
	const paths = (document as { paths?: Record<string, unknown> }).paths ?? {};
	for (const operation of Object.values(paths).flatMap((item) =>
		Object.values((item ?? {}) as Record<string, unknown>),
	)) {
		const { parameters } = (operation ?? {}) as { parameters?: unknown };
		for (const parameter of Array.isArray(parameters) ? parameters : []) {
			const { in: where, schema } = parameter as {
				in?: unknown;
				schema?: { default?: unknown; type?: unknown };
			};
			if (
				where === "query" &&
				schema?.type === "string" &&
				typeof schema.default === "boolean"
			) {
				schema.type = "boolean";
			}
		}
	}
	return document;
};

// Builds the server in `directory`, boots it on memory adapters and saves its OpenAPI document.
// pnpm sdk-generate reuses it.
export const documentSave = async ({
	directory,
	file,
	port,
	prepare,
}: {
	directory: string;
	file: string;
	port: number;
	prepare?: ((document: unknown) => unknown) | null;
}) => {
	processRun({
		command: "pnpm",
		args: ["build"],
		options: { cwd: directory, inherit: true },
	});
	const server: ChildProcess = spawn(
		"node",
		["--import", "varlock/auto-load", "build/server/index.js"],
		{
			cwd: directory,
			env: {
				...process.env,
				APP_ENV: "test",
				CACHE_URL: "memory://",
				DATABASE_URL: "memory://",
				HEALTH_PORT: String(port + 6000),
				PORT: String(port),
			},
			stdio: "inherit",
		},
	);
	try {
		for (let attempt = 0; attempt < 30; attempt++) {
			try {
				const response = await fetch(
					`http://localhost:${port}/api/v1/openapi.json`,
				);
				if (response.ok) {
					const document: unknown = await response.json();
					writeFileSync(
						file,
						JSON.stringify(prepare ? prepare(document) : document),
					);
					return;
				}
			} catch {
				// Not listening yet.
			}
			await setTimeout(1000);
		}
		throw new Error(
			`The server on port ${port} never served its OpenAPI document`,
		);
	} finally {
		server.kill();
	}
};

const usage = `Usage: pnpm api-check

Fails when this change breaks the API a client of origin/main already uses.

  -h, --help  this help`;

const main = async () => {
	if (argsParse({ options: {}, usage }) === undefined) return;
	// A probe: its exit status is the answer, so it runs through spawnSync, not processRun.
	if (spawnSync("oasdiff", ["--version"]).status !== 0) {
		console.error(installLine);
		process.exitCode = 1;
		return;
	}
	using scratch = mkdtempDisposableSync(join(tmpdir(), "api-check-"));
	const base = join(scratch.path, "main");
	const baseFile = join(scratch.path, "base.json");
	const revisionFile = join(scratch.path, "revision.json");
	const levelsFile = join(scratch.path, "levels.txt");
	try {
		writeFileSync(levelsFile, severityLevels);
		await documentSave({ directory: ".", file: revisionFile, port: 3100 });
		processRun({
			command: "git",
			args: ["worktree", "add", "--detach", base, "origin/main"],
			options: { cwd: ".", inherit: true },
		});
		processRun({
			command: "pnpm",
			args: ["install", "--frozen-lockfile"],
			options: { cwd: base, inherit: true },
		});
		// Inside a monorepo the app is a subfolder of the worktree.
		const prefix = gitRun(".", ["rev-parse", "--show-prefix"]).trim();
		await documentSave({
			directory: join(base, prefix),
			file: baseFile,
			port: 3101,
			prepare: queryBooleansTyped,
		});
		processRun({
			command: "oasdiff",
			args: [
				"breaking",
				baseFile,
				revisionFile,
				"--fail-on",
				"ERR",
				"--severity-levels",
				levelsFile,
			],
			options: { cwd: ".", inherit: true },
		});
	} finally {
		// Cleanup that may find no worktree (the add failed): its status is ignored.
		spawnSync("git", ["worktree", "remove", "--force", base]);
	}
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

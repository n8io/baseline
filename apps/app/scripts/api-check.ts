// pnpm api-check: fails when this change breaks the API a client already uses. It builds the
// OpenAPI document of origin/main and of the working tree, the way CI's `check` job does, and runs
// `oasdiff breaking --fail-on ERR` on the pair, with a removed operationId or tag raised to an error. docs/agents/api.md says what oasdiff allows.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installLine =
	"oasdiff is not on PATH. Install it with `brew install oasdiff`, or download v1.35.0 from https://github.com/oasdiff/oasdiff/releases.";

// oasdiff scores a renamed or removed operationId or tag as info, but SDK methods and CLI
// commands are named after them, so a client breaks: raise both to errors.
const severityLevels = "api-operation-id-removed err\napi-tag-removed err\n";

const step = ({
	args,
	command,
	cwd,
}: {
	args: string[];
	command: string;
	cwd: string;
}) => {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(" ")} failed`);
};

// A base document built before the problem `code` became an `x-extensible-enum` lists its codes
// as a closed `enum`. oasdiff reports that one-time switch as breaking on every response, so the
// base is read as the open list it is now. Delete this once no Project is older than that release.
export const problemCodesOpen = (document: unknown): unknown => {
	const walk = (node: unknown) => {
		if (Array.isArray(node)) node.forEach(walk);
		else if (node !== null && typeof node === "object") {
			const record = node as Record<string, unknown>;
			const problem = (
				record["application/problem+json"] as {
					schema?: { properties?: { code?: Record<string, unknown> } };
				}
			)?.schema;
			const code = problem?.properties?.code;
			if (code !== undefined && Array.isArray(code.enum)) {
				code["x-extensible-enum"] = code.enum;
				delete code.enum;
			}
			Object.values(record).forEach(walk);
		}
	};
	walk(document);
	return document;
};

// A base document built before the bearer scheme was declared has no `security`. oasdiff reports
// the first top-level requirement as "no longer allows anonymous access" on every operation, so the
// base is read as the secured document it is now (every /api/v1 route already needed a token).
// Delete this once no Project is older than that release.
export const securityBearerDeclare = (document: unknown): unknown => {
	const doc = document as {
		components?: { securitySchemes?: Record<string, unknown> };
		security?: unknown;
	};
	if (doc.security !== undefined) return document;
	doc.components = {
		...doc.components,
		securitySchemes: {
			bearer: { bearerFormat: "JWT", scheme: "bearer", type: "http" },
		},
	};
	doc.security = [{ bearer: [] }];
	return document;
};

// Builds the server in `directory`, boots it on memory adapters and saves its OpenAPI document.
const documentSave = async ({
	directory,
	file,
	port,
	prepare = (document) => document,
}: {
	directory: string;
	file: string;
	port: number;
	prepare?: (document: unknown) => unknown;
}) => {
	step({ args: ["build"], command: "pnpm", cwd: directory });
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
					writeFileSync(file, JSON.stringify(prepare(document)));
					return;
				}
			} catch {
				// Not listening yet.
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		throw new Error(
			`The server on port ${port} never served its OpenAPI document`,
		);
	} finally {
		server.kill();
	}
};

const main = async () => {
	if (spawnSync("oasdiff", ["--version"]).status !== 0) {
		console.error(installLine);
		process.exit(1);
	}
	const scratch = mkdtempSync(join(tmpdir(), "api-check-"));
	const base = join(scratch, "main");
	const baseFile = join(scratch, "base.json");
	const revisionFile = join(scratch, "revision.json");
	const levelsFile = join(scratch, "levels.txt");
	try {
		writeFileSync(levelsFile, severityLevels);
		await documentSave({ directory: ".", file: revisionFile, port: 3100 });
		step({
			args: ["worktree", "add", "--detach", base, "origin/main"],
			command: "git",
			cwd: ".",
		});
		step({
			args: ["install", "--frozen-lockfile"],
			command: "pnpm",
			cwd: base,
		});
		// Inside a monorepo the app is a subfolder of the worktree.
		const prefix = spawnSync("git", ["rev-parse", "--show-prefix"], {
			encoding: "utf8",
		}).stdout.trim();
		await documentSave({
			directory: join(base, prefix),
			file: baseFile,
			port: 3101,
			prepare: (document) => securityBearerDeclare(problemCodesOpen(document)),
		});
		step({
			args: [
				"breaking",
				baseFile,
				revisionFile,
				"--fail-on",
				"ERR",
				"--severity-levels",
				levelsFile,
			],
			command: "oasdiff",
			cwd: ".",
		});
	} finally {
		spawnSync("git", ["worktree", "remove", "--force", base]);
		rmSync(scratch, { force: true, recursive: true });
	}
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}

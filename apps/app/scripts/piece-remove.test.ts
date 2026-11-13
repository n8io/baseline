import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	pieceFilesRemove,
	pieceRemovals,
	pieceRemoveRefusal,
} from "./piece-remove.ts";
import { run } from "./template-render.ts";

// Built, never written out, so a removal run over this file finds no block in it.
const marker = (edge: "end" | "start", piece: string, comment = "//") =>
	`${comment} piece-${edge}: ${piece}`;
const block = (piece: string, body: string, comment = "//") =>
	[marker("start", piece, comment), body, marker("end", piece, comment)].join(
		"\n",
	);

const manifest = {
	dependencies: {
		"@n8io/baseline-cache": "^1.0.0",
		"@n8io/baseline-live": "^1.0.0",
		"@n8io/baseline-queue": "^1.0.0",
		react: "^19.0.0",
		"react-router": "^7.0.0",
		redis: "^5.0.0",
	},
	imports: { "#env": "./src/env.ts", "#ui/*": "./src/ui/*" },
	scripts: {
		build: "react-router build",
		check: "varlock codegen && react-router typegen && biome check .",
		dev: "docker compose up -d --wait && (HEALTH_PORT=9001 node --watch --import ./src/preload.ts src/worker.ts & node --import ./src/preload.ts --conditions=development ./node_modules/@react-router/dev/bin.cjs dev)",
	},
};

const projectFiles: Record<string, string> = {
	".env.schema": [
		"# where the cache lives",
		"CACHE_URL=",
		"PORT=3000",
		"# schedule overrides: a cron string or off",
		"# @sensitive=false @required=false",
		"SCHEDULE_INVOICE_STALE_ARCHIVE=",
		"# domain-create: schedules",
		"# Mixpanel project token",
		"# @required=forEnv(production)",
		"MIXPANEL_TOKEN=",
		"",
	].join("\n"),
	".env.production": "PORT=3000\nMIXPANEL_TOKEN=op(op://app/mixpanel/token)\n",
	".env.test": "CACHE_URL=memory://\nPORT=3000\n",
	"biome.json": `${JSON.stringify({ css: {}, files: { includes: ["**", "!.react-router"] } }, null, "\t")}\n`,
	"compose.yaml": `services:\n${block("redis", "  redis:\n    image: redis", "#")}\n  postgres:\n    image: postgres\n`,
	"docs/agents/pieces.md": `${block("live", "Kept: docs are left alone.")}\n`,
	"package.json": `${JSON.stringify(manifest, null, "\t")}\n`,
	"public/favicon.ico": "icon",
	"src/domains/invoice/api/invoice-live.test.ts": "test\n",
	"src/domains/invoice/api/invoice-live.ts": "live\n",
	"src/analytics-open.ts": "analytics\n",
	"src/domains/invoice/api/invoice-schedule.ts": "schedule\n",
	"src/domains/invoice/spi/invoice-cache.ts": "cache\n",
	"src/domains/invoice/spi/invoice-cache.test.ts": "cache\n",
	"src/domains/invoice/spi/invoice-cached.ts": "cache\n",
	"src/domains/invoice/spi/invoice-transaction.postgres.test.ts": "events\n",
	"src/domains/invoice/spi/invoice-transaction.postgres.ts": "transaction\n",
	"src/domains/invoice/use-cases/invoice-use-cases-analytics.test.ts": "test\n",
	"src/redis.ts": "redis\n",
	"src/server.ts": [
		'import { Hono } from "hono";',
		"",
		"export const app = new Hono();",
		block("live", 'app.route("/live", liveRoutes);'),
		block("cache", "\tcache: redisClient,"),
		block("analytics", "\tanalytics: analyticsOpen(),"),
		"",
	].join("\n"),
	"src/ui/routes/home.tsx": "home\n",
	"src/worker.ts": "worker\n",
	"vite.config.ts": "react router\n",
};

const directories: string[] = [];
afterEach(() => {
	for (const d of directories.splice(0))
		rmSync(d, { force: true, recursive: true });
});

const projectCreate = (extra: Record<string, string> = {}): string => {
	const directory = mkdtempSync(join(tmpdir(), "piece-remove-"));
	directories.push(directory);
	// Generated, and ignored by git.
	mkdirSync(join(directory, ".react-router/types"), { recursive: true });
	writeFileSync(join(directory, ".gitignore"), ".react-router/\n");
	for (const [path, text] of Object.entries({ ...projectFiles, ...extra })) {
		mkdirSync(dirname(join(directory, path)), { recursive: true });
		writeFileSync(join(directory, path), text);
	}
	const git = (...args: string[]) =>
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
			cwd: directory,
		});
	git("init", "--quiet");
	git("add", "-A");
	git("commit", "--quiet", "-m", "Create");
	return directory;
};

const read = (directory: string, path: string) =>
	readFileSync(join(directory, path), "utf8");

const manifestWrite = (
	directory: string,
	dependencies: Record<string, string>,
) => {
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ ...manifest, dependencies }),
	);
	run(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "Remove"],
		{
			cwd: directory,
		},
	);
};

describe("pieceRemoveRefusal", () => {
	it("names the pieces when the piece is unknown or missing", () => {
		const directory = projectCreate();
		const pieces = Object.keys(pieceRemovals).join("|");
		expect(pieceRemoveRefusal(directory, "pages")).toBe(
			`usage: pnpm piece-remove <${pieces}>`,
		);
		expect(pieceRemoveRefusal(directory, undefined)).toContain("usage");
	});

	it("refuses a tree with uncommitted changes", () => {
		const directory = projectCreate();
		writeFileSync(join(directory, "notes.txt"), "draft");
		expect(pieceRemoveRefusal(directory, "live")).toMatch(/^Commit or stash/);
	});

	it("refuses redis until the cache and live updates are gone", () => {
		const directory = projectCreate();
		expect(pieceRemoveRefusal(directory, "redis")).toBe(
			"Remove the cache and live updates first: both run on Redis.",
		);
		const { "@n8io/baseline-cache": _, ...withoutCache } =
			manifest.dependencies;
		manifestWrite(directory, withoutCache);
		expect(pieceRemoveRefusal(directory, "redis")).toContain("first");
		const { "@n8io/baseline-live": __, ...withoutBoth } = withoutCache;
		manifestWrite(directory, withoutBoth);
		expect(pieceRemoveRefusal(directory, "redis")).toBeUndefined();
	});

	it("refuses the queue while a Consumer is left, but not for a test that uses one", () => {
		const consumerTest = {
			"src/domains/invoice/spi/invoice-events.test.ts": "queueConsumerCreate\n",
		};
		expect(
			pieceRemoveRefusal(projectCreate(consumerTest), "queue"),
		).toBeUndefined();
		const consumer = {
			"src/consumers/invoice-archive.ts": "queueConsumerCreate({})\n",
		};
		expect(pieceRemoveRefusal(projectCreate(consumer), "queue")).toBe(
			"Remove your Consumers first: they run only in the Worker.",
		);
	});
});

describe("pieceFilesRemove", () => {
	it("deletes live's files and blocks and leaves Markdown alone", () => {
		const directory = projectCreate();
		pieceFilesRemove(directory, "live");
		expect(
			existsSync(join(directory, "src/domains/invoice/api/invoice-live.ts")),
		).toBe(false);
		expect(
			existsSync(
				join(directory, "src/domains/invoice/api/invoice-live.test.ts"),
			),
		).toBe(false);
		expect(read(directory, "src/server.ts")).not.toContain("liveRoutes");
		expect(read(directory, "src/server.ts")).toContain("cache: redisClient");
		expect(read(directory, "docs/agents/pieces.md")).toContain(
			marker("start", "live"),
		);
	});

	it("deletes the cache's adapters only", () => {
		const directory = projectCreate();
		pieceFilesRemove(directory, "cache");
		const spi = join(directory, "src/domains/invoice/spi");
		expect(existsSync(join(spi, "invoice-cache.ts"))).toBe(false);
		expect(existsSync(join(spi, "invoice-cache.test.ts"))).toBe(false);
		expect(existsSync(join(spi, "invoice-cached.ts"))).toBe(false);
		expect(existsSync(join(spi, "invoice-transaction.postgres.ts"))).toBe(true);
		expect(read(directory, "src/server.ts")).not.toContain("redisClient");
	});

	it("drops CACHE_URL from the env files with redis, and its compose service", () => {
		const directory = projectCreate();
		pieceFilesRemove(directory, "redis");
		expect(read(directory, ".env.schema")).toBe(
			projectFiles[".env.schema"]?.replace(
				"# where the cache lives\nCACHE_URL=\n",
				"",
			),
		);
		expect(read(directory, ".env.test")).toBe("PORT=3000\n");
		expect(read(directory, "compose.yaml")).toBe(
			"services:\n  postgres:\n    image: postgres\n",
		);
		expect(existsSync(join(directory, "src/redis.ts"))).toBe(false);
	});

	it("drops analytics, its test and MIXPANEL_TOKEN with the analytics piece", () => {
		const directory = projectCreate();
		pieceFilesRemove(directory, "analytics");
		expect(existsSync(join(directory, "src/analytics-open.ts"))).toBe(false);
		expect(
			existsSync(
				join(
					directory,
					"src/domains/invoice/use-cases/invoice-use-cases-analytics.test.ts",
				),
			),
		).toBe(false);
		expect(read(directory, "src/server.ts")).not.toContain("analyticsOpen");
		expect(read(directory, ".env.schema")).toBe(
			projectFiles[".env.schema"]?.replace(
				"# Mixpanel project token\n# @required=forEnv(production)\nMIXPANEL_TOKEN=\n",
				"",
			),
		);
		expect(read(directory, ".env.production")).toBe("PORT=3000\n");
	});

	it("drops the Worker, its schedules and their overrides with the queue", () => {
		const directory = projectCreate();
		pieceFilesRemove(directory, "queue");
		expect(existsSync(join(directory, "src/worker.ts"))).toBe(false);
		const domain = join(directory, "src/domains/invoice");
		expect(existsSync(join(domain, "api/invoice-schedule.ts"))).toBe(false);
		expect(
			existsSync(join(domain, "spi/invoice-transaction.postgres.test.ts")),
		).toBe(false);
		expect(
			existsSync(join(domain, "spi/invoice-transaction.postgres.ts")),
		).toBe(true);
		expect(read(directory, ".env.schema")).not.toContain("SCHEDULE_");
		expect(read(directory, ".env.schema")).not.toContain("domain-create");
		const dev = (JSON.parse(read(directory, "package.json")) as typeof manifest)
			.scripts.dev;
		expect(dev).toBe(
			"docker compose up -d --wait && node --import ./src/preload.ts --conditions=development ./node_modules/@react-router/dev/bin.cjs dev",
		);
	});

	it("turns the ui-less server into one that serves itself, once", () => {
		const directory = projectCreate();
		pieceFilesRemove(directory, "ui");
		pieceFilesRemove(directory, "ui");
		for (const path of [
			".react-router",
			"src/ui",
			"public",
			"react-router.config.ts",
		]) {
			expect(existsSync(join(directory, path))).toBe(false);
		}
		const server = read(directory, "src/server.ts");
		expect(
			server.startsWith('import { serve } from "@hono/node-server";\n'),
		).toBe(true);
		expect(server.match(/serverServe\(serve\(/g)).toHaveLength(1);
		expect(read(directory, "vite.config.ts")).toContain('ssr: "src/server.ts"');
		expect(JSON.parse(read(directory, "biome.json"))).toEqual({
			files: { includes: ["**"] },
		});
		const edited = JSON.parse(
			read(directory, "package.json"),
		) as typeof manifest;
		expect(edited.imports).toEqual({ "#env": "./src/env.ts" });
		expect(edited.scripts.build).toBe("vite build");
		expect(edited.scripts.dev).toContain(
			"node --watch --import ./src/preload.ts src/server.ts)",
		);
	});

	it("fails when a block has no end", () => {
		const directory = projectCreate({
			"src/env.ts": `${marker("start", "cache")}\nconst a = 1;\n`,
		});
		expect(() => pieceFilesRemove(directory, "cache")).toThrow(
			"piece-start: cache has no matching piece-end in src/env.ts",
		);
	});
});

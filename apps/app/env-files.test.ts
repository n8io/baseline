import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const fileRead = (name: string) => readFileSync(`${appRoot}${name}`, "utf8");
const keys = (name: string) => Object.keys(parseEnv(fileRead(name)));

// varlock itself, as `pnpm dev` and the tests load it: every required item has a value and every
// value has its type. Only the committed files count: no `.local` file, and none of this
// process's own values of the items.
const varlockLoad = (appEnv: "development" | "test", dir = appRoot) =>
	spawnSync(
		`${appRoot}node_modules/.bin/varlock`,
		["load", "-p", join(dir, ".env.schema"), "-p", join(dir, `.env.${appEnv}`)],
		{
			cwd: dir,
			encoding: "utf8",
			env: {
				...process.env,
				...Object.fromEntries(
					keys(".env.schema").map((key) => [key, undefined]),
				),
				// The Vitest worker's serialized varlock env would win over the files.
				__VARLOCK_ENV: undefined,
				APP_ENV: appEnv,
				DO_NOT_TRACK: "1",
			},
			timeout: 15_000,
		},
	);

describe("env files", () => {
	it.each(["development", "test"] as const)(
		".env.%s loads against .env.schema",
		(appEnv) => {
			const { status, stderr, stdout } = varlockLoad(appEnv);
			expect({ status, stderr, stdout }).toMatchObject({ status: 0 });
		},
	);

	it("fail to load when a required item has no value", () => {
		const dir = mkdtempSync(join(tmpdir(), "env-files-"));
		onTestFinished(() => rmSync(dir, { force: true, recursive: true }));
		writeFileSync(
			join(dir, ".env.schema"),
			"# @currentEnv=$APP_ENV\n# @defaultRequired=true\n# ---\nAPP_ENV=test\nA_KEY=\n",
		);
		writeFileSync(join(dir, ".env.test"), "A_KEY=\n");
		const { status, stderr } = varlockLoad("test", dir);
		expect({ status, stderr }).toMatchObject({
			status: 1,
			stderr: expect.stringContaining("A_KEY"),
		});
	});

	it("set only items .env.schema declares", () => {
		const declared = new Set(keys(".env.schema"));
		const undeclared = ["development", "production", "test"].flatMap((env) =>
			keys(`.env.${env}`)
				.filter((key) => !declared.has(key))
				.map((key) => `.env.${env}: ${key}`),
		);
		expect(undeclared).toEqual([]);
	});

	// Shows only the text before "=", never a value.
	it("give production only op() references", () => {
		const notReferences = fileRead(".env.production")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.filter((line) => !/^[A-Z][A-Z0-9_]*=op\(op:\/\/[^)\s]+\)$/.test(line))
			.map((line) => line.split("=")[0]);
		expect(notReferences).toEqual([]);
	});
});

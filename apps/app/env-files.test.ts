import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const fileRead = (name: string) => readFileSync(`${appRoot}${name}`, "utf8");
const keys = (name: string) => Object.keys(parseEnv(fileRead(name)));

// varlock itself, as `pnpm dev` and the tests load it: every required item has a value and every
// value has its type. This process's own values of the items are dropped, so they hide no gap.
const varlockLoad = (appEnv: "development" | "test") =>
	spawnSync(`${appRoot}node_modules/.bin/varlock`, ["load"], {
		cwd: appRoot,
		encoding: "utf8",
		env: {
			...process.env,
			...Object.fromEntries(keys(".env.schema").map((key) => [key, undefined])),
			// The Vitest worker's serialized varlock env would win over the files.
			__VARLOCK_ENV: undefined,
			APP_ENV: appEnv,
			DO_NOT_TRACK: "1",
		},
	});

describe("env files", () => {
	it.each(["development", "test"] as const)(
		".env.%s loads against .env.schema",
		(appEnv) => {
			const { status, stderr, stdout } = varlockLoad(appEnv);
			expect({ status, stderr, stdout }).toMatchObject({ status: 0 });
		},
	);

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

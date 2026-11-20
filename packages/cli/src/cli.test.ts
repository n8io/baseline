import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliCreate } from "./cli.ts";
import { cliTestDocument, cliTestOperations } from "./cli-test-app.ts";
import { cliTestProcessRun } from "./cli-test-process.ts";

const url = "http://127.0.0.1:1";
let config: string;

const cliRun = (
	args: string[],
	env: Record<string, string> = {},
	stdin?: string,
) =>
	cliTestProcessRun({
		args,
		config,
		env,
		...(stdin === undefined ? {} : { stdin }),
	});

beforeAll(async () => {
	config = await mkdtemp(join(tmpdir(), "cli-test-"));
});

afterAll(async () => {
	await rm(config, { force: true, recursive: true });
});

describe("cliCreate", () => {
	it("calls fooCreate with the body from its flags and prints the JSON", async () => {
		const { code, stdout } = await cliRun(
			["foo", "create", "--name", "x", "--size", "3", "--tags", "a", "b"],
			{ ACME_APP_URL: url },
		);
		expect(code).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			args: [{ name: "x", size: 3, tags: ["a", "b"] }, { baseUrl: url }],
		});
	});

	it("passes path fields in path order, then the query, then the request", async () => {
		const assign = await cliRun([
			"invoice-line",
			"customer-assign",
			"--customer-id",
			"c",
			"--invoice-line-id",
			"i",
			"--url",
			`${url}/`,
		]);
		expect(JSON.parse(assign.stdout).args).toEqual([
			"i",
			"c",
			{ baseUrl: url },
		]);
		const list = await cliRun(["foo", "list", "--name-prefix", "ab"], {
			ACME_APP_URL: url,
		});
		expect(JSON.parse(list.stdout).args).toEqual([
			{ name_prefix: "ab" },
			{ baseUrl: url },
		]);
	});

	it("orders path, body and query as the SDK takes them, with typed values", async () => {
		const flags = await cliRun(
			[
				"foo",
				"update",
				"--id",
				"f",
				"--ids",
				"4",
				"5",
				"--note",
				"123",
				"--no-dry",
			],
			{ ACME_APP_URL: url },
		);
		expect(JSON.parse(flags.stdout).args).toEqual([
			"f",
			{ ids: [4, 5], note: "123" },
			{ dry: false },
			{ baseUrl: url },
		]);
		const queryOnly = await cliRun(["foo", "update", "--id", "f", "--dry"], {
			ACME_APP_URL: url,
		});
		// The fake answers with JSON, where an undefined body slot reads as null.
		expect(JSON.parse(queryOnly.stdout).args).toEqual([
			"f",
			null,
			{ dry: true },
			{ baseUrl: url },
		]);
	});

	it("sends a --data array as it is, and refuses body flags on top of one", async () => {
		const array = await cliRun(["foo", "create", "--data", '["a"]'], {
			ACME_APP_URL: url,
		});
		expect(JSON.parse(array.stdout).args[0]).toEqual(["a"]);
		const mixed = await cliRun(
			["foo", "create", "--data", '["a"]', "--name", "x"],
			{ ACME_APP_URL: url },
		);
		expect(mixed).toMatchObject({
			code: 1,
			stderr: "--data is not a JSON object, so body flags cannot add to it.\n",
		});
	});

	it("sends --data as the body, from JSON or a file, under the flags", async () => {
		const file = join(config, "body.json");
		await writeFile(file, '{"name":"from-file"}');
		const inline = await cliRun(
			["foo", "create", "--data", '{"name":"d","size":1}', "--size", "2"],
			{ ACME_APP_URL: url },
		);
		expect(JSON.parse(inline.stdout).args[0]).toEqual({ name: "d", size: 2 });
		const fromFile = await cliRun(["foo", "create", "--data", `@${file}`], {
			ACME_APP_URL: url,
		});
		expect(JSON.parse(fromFile.stdout).args[0]).toEqual({ name: "from-file" });
	});

	it("prints a Problem's title and code to stderr and exits 1", async () => {
		const { code, stderr, stdout } = await cliRun(
			["foo", "create", "--name", "taken"],
			{ ACME_APP_URL: url },
		);
		expect({ code, stderr, stdout }).toEqual({
			code: 1,
			stderr: "Conflict: FooNameTaken\n",
			stdout: "",
		});
	});

	it("picks the URL from --url, else --env, else ACME_APP_URL, else ACME_APP_ENV", async () => {
		const baseUrlOf = async (args: string[], env: Record<string, string>) =>
			JSON.parse(
				(await cliRun(["foo", "get", "--id", "1", ...args], env)).stdout,
			).args[1].baseUrl;
		const production = "https://api.acme.example";
		expect(await baseUrlOf([], { ACME_APP_ENV: "production" })).toBe(
			production,
		);
		expect(
			await baseUrlOf([], { ACME_APP_ENV: "production", ACME_APP_URL: url }),
		).toBe(url);
		expect(
			await baseUrlOf(["--env", "production"], { ACME_APP_URL: url }),
		).toBe(production);
		expect(
			await baseUrlOf(["--env", "production", "--url", `${url}/`], {}),
		).toBe(url);
	});

	it("exits 1 naming the environments without one, or with an unknown one", async () => {
		const none = await cliRun(["foo", "get", "--id", "1"]);
		expect(none).toMatchObject({
			code: 1,
			stderr:
				"Pick an environment with --env or ACME_APP_ENV (development, production), or set a URL with --url or ACME_APP_URL.\n",
		});
		const unknown = await cliRun(["foo", "get", "--id", "1", "--env", "dev"], {
			ACME_APP_URL: url,
		});
		expect(unknown).toMatchObject({
			code: 1,
			stderr: "No environment dev: pick one of development, production.\n",
		});
		const fromEnvVar = await cliRun(["foo", "get", "--id", "1"], {
			ACME_APP_ENV: "dev",
		});
		expect(fromEnvVar.stderr).toBe(
			"No environment dev: pick one of development, production.\n",
		);
		// A relative, templated or unnamed server names no environment.
		const unlisted = await cliRun(["foo", "get", "--id", "1"], {
			ACME_APP_ENV: "development",
			CLI_TEST_SERVERS: JSON.stringify([
				{ description: "development", url: "/" },
				{ description: "eu", url: "https://{region}.acme.example" },
				{ url: "https://api.acme.example" },
			]),
		});
		expect(unlisted.stderr).toBe(
			"No environment development: pick one of none: use a URL.\n",
		);
		const empty = await cliRun(["foo", "get", "--id", "1", "--env", ""], {
			ACME_APP_ENV: "production",
		});
		expect(empty).toMatchObject({ code: 1, stderr: "--env needs a value.\n" });
	});

	it("exits 1 without a required path field", async () => {
		const noId = await cliRun(["foo", "get"], { ACME_APP_URL: url });
		expect(noId.code).toBe(1);
		expect(noId.stderr).toContain("'--id <value>' not specified");
	});

	it("lists commands grouped by tag in --help, with each operation's summary", async () => {
		const root = await cliRun(["--help"]);
		expect(root.code).toBe(0);
		expect(root.stdout).toMatch(/foo\s+Foos and their names/);
		expect(root.stdout).toMatch(/invoice-line\s+customer-assign/);
		expect(root.stdout).toMatch(/login/);
		expect(root.stdout.replace(/\s+/g, " ")).toContain(
			"the environment (default ACME_APP_ENV): development, production",
		);
		const login = await cliRun(["login", "--help"]);
		expect(login.stdout).toMatch(/--env <name>/);
		const foo = await cliRun(["foo", "--help"]);
		expect(foo.stdout).toMatch(/create \[options\]\s+Create a foo/);
		expect(foo.stdout).toMatch(/get \[options\]\s+Read a foo/);
		const create = await cliRun(["foo", "create", "--help"]);
		expect(create.stdout).toContain("Create a foo with a unique name.");
		expect(create.stdout).toContain("--name <value>");
	});

	it("shows each flag's description, allowed values and default in --help", async () => {
		const { stdout } = await cliRun(["foo", "list", "--help"]);
		// commander wraps long help lines.
		const help = stdout.replace(/\s+/g, " ");
		expect(help).toContain(
			"--sort <value> sort (query): The order of the page (choices: createdAt, -createdAt, name, -name) (default: -createdAt)",
		);
		expect(help).toContain(
			"--count count (query): Count every match (default: false)",
		);
	});

	it("refuses a value outside the schema's enum before any request, and sends one inside it", async () => {
		const bogus = await cliRun(["foo", "list", "--sort", "bogus"], {
			ACME_APP_URL: url,
		});
		expect(bogus.code).toBe(1);
		expect(bogus.stdout).toBe("");
		expect(bogus.stderr).toContain(
			"Allowed choices are createdAt, -createdAt, name, -name.",
		);
		const name = await cliRun(["foo", "list", "--sort", "name", "--count"], {
			ACME_APP_URL: url,
		});
		expect(JSON.parse(name.stdout).args).toEqual([
			{ count: true, sort: "name" },
			{ baseUrl: url },
		]);
	});

	it("throws when operations lacks one of the document's operations", () => {
		const { fooGet: _, ...operations } = cliTestOperations;
		expect(() =>
			cliCreate({ document: cliTestDocument, name: "acme-app", operations }),
		).toThrow(
			new TypeError(
				"cliCreate: operations has no fooGet; regenerate the SDK from this document",
			),
		);
	});
});

describe("the published types", () => {
	it("name no commander type", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "cli-dts-"));
		await build({
			config: false,
			cwd: join(import.meta.dirname, ".."),
			dts: true,
			entry: ["src/index.ts"],
			logLevel: "silent",
			outDir,
		});
		const types = await readFile(join(outDir, "index.d.ts"), "utf8").catch(() =>
			readFile(join(outDir, "index.d.mts"), "utf8"),
		);
		await rm(outDir, { force: true, recursive: true });
		expect(types).toContain("cliCreate");
		expect(types).not.toMatch(/commander|\bCommand\b/);
	}, 30_000);
});

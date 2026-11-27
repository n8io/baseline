// Runs the CLI inside the test's own process, so Stryker sees which tests reach which lines of
// cli.ts and cli-login.ts. (A command run as a child process, as cli.test.ts does, is invisible to
// its coverage.) The tests read the output the CLI writes, its exit code and the files it stores.
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliOperation, cliCreate } from "./cli.ts";
import type { CliDocument } from "./cli-commands-read.ts";
import { cliEnvPrefix } from "./cli-login.ts";
import { cliTestDocument, cliTestOperations } from "./cli-test-app.ts";

const url = "http://127.0.0.1:1";
let config: string;

type RunResult = { code: number; stderr: string; stdout: string };

/** Runs one command in this process, with `env` set and the CLI's output and exit code read back. */
const cliRun = async (
	args: string[],
	{
		document = cliTestDocument,
		env = {},
		name = "acme-app",
		operations = cliTestOperations,
	}: {
		document?: CliDocument;
		env?: Record<string, string>;
		name?: string;
		operations?: Record<string, CliOperation>;
	} = {},
): Promise<RunResult> => {
	const set: Record<string, string> = { XDG_CONFIG_HOME: config, ...env };
	const before = Object.keys(set).map(
		(key) => [key, process.env[key]] as const,
	);
	const out: string[] = [];
	const err: string[] = [];
	const { write: outWrite } = process.stdout;
	const { write: errWrite } = process.stderr;
	const codeBefore = process.exitCode;
	for (const [key, value] of Object.entries(set)) process.env[key] = value;
	process.exitCode = undefined;
	process.stdout.write = ((chunk: string) => {
		out.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: string) => {
		err.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;
	try {
		await cliCreate({ document, name, operations }).run(args);
		return {
			code: Number(process.exitCode ?? 0),
			stderr: err.join(""),
			stdout: out.join(""),
		};
	} finally {
		process.stdout.write = outWrite;
		process.stderr.write = errWrite;
		process.exitCode = codeBefore;
		for (const [key, value] of before) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

const argsOf = (run: RunResult): unknown => JSON.parse(run.stdout).args;

beforeAll(async () => {
	config = await mkdtemp(join(tmpdir(), "cli-inprocess-"));
});

afterAll(async () => {
	await rm(config, { force: true, recursive: true });
});

describe("cliCreate in process: arguments", () => {
	it("prints the response as indented JSON and calls with the body from the flags", async () => {
		const run = await cliRun(
			["foo", "create", "--name", "x", "--size", "3", "--tags", "a", "b"],
			{ env: { ACME_APP_URL: url } },
		);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		expect(run.stdout).toBe(
			`${JSON.stringify(
				{ args: [{ name: "x", size: 3, tags: ["a", "b"] }, { baseUrl: url }] },
				null,
				2,
			)}\n`,
		);
	});

	it("passes path fields in path order, then the body, then the query, then the request", async () => {
		const assign = await cliRun(
			[
				"invoice-line",
				"customer-assign",
				"--customer-id",
				"c",
				"--invoice-line-id",
				"i",
				"--url",
				`${url}///`,
			],
			{},
		);
		expect(argsOf(assign)).toEqual(["i", "c", { baseUrl: url }]);
		const list = await cliRun(["foo", "list", "--name-prefix", "ab"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(list)).toEqual([{ name_prefix: "ab" }, { baseUrl: url }]);
		const bare = await cliRun(["foo", "list"], { env: { ACME_APP_URL: url } });
		expect(argsOf(bare)).toEqual([null, { baseUrl: url }]);
		const update = await cliRun(
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
			{ env: { ACME_APP_URL: url } },
		);
		expect(argsOf(update)).toEqual([
			"f",
			{ ids: [4, 5], note: "123" },
			{ dry: false },
			{ baseUrl: url },
		]);
		const queryOnly = await cliRun(["foo", "update", "--id", "f", "--dry"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(queryOnly)).toEqual([
			"f",
			null,
			{ dry: true },
			{ baseUrl: url },
		]);
	});

	it("sends a boolean body flag on and off, and nothing when it is not given", async () => {
		const on = await cliRun(["foo", "create", "--name", "n", "--draft"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(on)).toEqual([{ draft: true, name: "n" }, { baseUrl: url }]);
		const off = await cliRun(["foo", "create", "--name", "n", "--no-draft"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(off)).toEqual([
			{ draft: false, name: "n" },
			{ baseUrl: url },
		]);
		const neither = await cliRun(["foo", "create", "--name", "n"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(neither)).toEqual([{ name: "n" }, { baseUrl: url }]);
	});

	it("sends an empty body object when a body operation gets no flag and no --data", async () => {
		const run = await cliRun(["foo", "update", "--id", "f"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(run)).toEqual(["f", null, null, { baseUrl: url }]);
	});

	it("refuses a text that is not a number, naming the flag and the text", async () => {
		const run = await cliRun(
			["foo", "create", "--name", "n", "--size", "abc"],
			{
				env: { ACME_APP_URL: url },
			},
		);
		expect(run).toEqual({
			code: 1,
			stderr:
				"error: option '--size <value>' argument 'abc' is invalid. abc is not a number.\n",
			stdout: "",
		});
	});

	it("reads a number flag as a number, zero and decimals included", async () => {
		const zero = await cliRun(["foo", "create", "--name", "n", "--size", "0"], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(zero)).toEqual([{ name: "n", size: 0 }, { baseUrl: url }]);
		const decimal = await cliRun(
			["foo", "create", "--name", "n", "--size", "2.5"],
			{ env: { ACME_APP_URL: url } },
		);
		expect(argsOf(decimal)).toEqual([
			{ name: "n", size: 2.5 },
			{ baseUrl: url },
		]);
	});

	it("sends --data as the body, from JSON or a file, under the flags", async () => {
		const file = join(config, "body.json");
		await writeFile(file, '{"name":"from-file"}');
		const inline = await cliRun(
			["foo", "create", "--data", '{"name":"d","size":1}', "--size", "2"],
			{ env: { ACME_APP_URL: url } },
		);
		expect(argsOf(inline)).toEqual([{ name: "d", size: 2 }, { baseUrl: url }]);
		const fromFile = await cliRun(["foo", "create", "--data", `@${file}`], {
			env: { ACME_APP_URL: url },
		});
		expect(argsOf(fromFile)).toEqual([{ name: "from-file" }, { baseUrl: url }]);
		const noFile = await cliRun(
			["foo", "create", "--data", `@${join(config, "missing.json")}`],
			{ env: { ACME_APP_URL: url } },
		);
		expect(noFile.code).toBe(1);
		expect(noFile.stderr).toContain("ENOENT");
		const badJson = await cliRun(["foo", "create", "--data", "{nope"], {
			env: { ACME_APP_URL: url },
		});
		expect(badJson.code).toBe(1);
		expect(badJson.stderr).toMatch(/JSON/);
	});

	it("sends a --data that is not an object as it is, and refuses body flags on top of it", async () => {
		for (const data of ['["a"]', '"text"', "7", "null"]) {
			const run = await cliRun(["foo", "create", "--data", data], {
				env: { ACME_APP_URL: url },
			});
			expect(argsOf(run)).toEqual([JSON.parse(data), { baseUrl: url }]);
		}
		for (const data of ['["a"]', "null", "7"]) {
			const mixed = await cliRun(
				["foo", "create", "--data", data, "--name", "x"],
				{ env: { ACME_APP_URL: url } },
			);
			expect(mixed).toEqual({
				code: 1,
				stderr:
					"--data is not a JSON object, so body flags cannot add to it.\n",
				stdout: "",
			});
		}
	});

	it("takes a value from --data when no flag names it, and a flag wins over --data", async () => {
		const run = await cliRun(
			["foo", "create", "--data", '{"name":"d","tags":["z"]}', "--tags", "a"],
			{ env: { ACME_APP_URL: url } },
		);
		expect(argsOf(run)).toEqual([{ name: "d", tags: ["a"] }, { baseUrl: url }]);
	});
});

describe("cliCreate in process: values and choices", () => {
	const document: CliDocument = {
		info: { title: "t", version: "1" },
		paths: {
			"/things": {
				post: {
					operationId: "thingCreate",
					requestBody: {
						content: {
							"application/json": {
								schema: {
									properties: {
										config: { type: "object" },
										level: { enum: [1, 2, 10], type: "integer" },
										modes: {
											items: { enum: ["a", "b"], type: "string" },
											type: "array",
										},
										sizes: {
											items: { enum: [1, 2], type: "integer" },
											type: "array",
										},
									},
									required: ["level"],
									type: "object",
								},
							},
						},
					},
					summary: "Create a thing",
					tags: ["thing"],
				},
			},
		},
	};
	const operations = {
		thingCreate: async (...args: readonly unknown[]) => ({
			data: { args },
			status: 200,
		}),
	};
	const run = (args: string[]) =>
		cliRun(["thing", "create", ...args], {
			document,
			env: { ACME_APP_URL: url },
			operations,
		});

	it("parses a json flag, and keeps text that is not JSON as text", async () => {
		const object = await run(["--level", "1", "--config", '{"a":[1]}']);
		expect(argsOf(object)).toEqual([
			{ config: { a: [1] }, level: 1 },
			{ baseUrl: url },
		]);
		const text = await run(["--level", "1", "--config", "plain"]);
		expect(argsOf(text)).toEqual([
			{ config: "plain", level: 1 },
			{ baseUrl: url },
		]);
	});

	it("checks a number enum as a number, so 01 is 1, and refuses what is outside it", async () => {
		const padded = await run(["--level", "01"]);
		expect(argsOf(padded)).toEqual([{ level: 1 }, { baseUrl: url }]);
		const ten = await run(["--level", "10"]);
		expect(argsOf(ten)).toEqual([{ level: 10 }, { baseUrl: url }]);
		const refused = await run(["--level", "3"]);
		expect(refused).toEqual({
			code: 1,
			stderr:
				"error: option '--level <value>' argument '3' is invalid. Allowed choices are 1, 2, 10.\n",
			stdout: "",
		});
	});

	it("collects an array flag item by item, each checked against the item's enum", async () => {
		const ok = await run(["--level", "1", "--modes", "a", "b", "--sizes", "2"]);
		expect(argsOf(ok)).toEqual([
			{ level: 1, modes: ["a", "b"], sizes: [2] },
			{ baseUrl: url },
		]);
		const repeated = await run([
			"--level",
			"1",
			"--modes",
			"a",
			"--modes",
			"b",
		]);
		expect(argsOf(repeated)).toEqual([
			{ level: 1, modes: ["a", "b"] },
			{ baseUrl: url },
		]);
		const refused = await run(["--level", "1", "--modes", "a", "c"]);
		expect(refused).toEqual({
			code: 1,
			stderr:
				"error: option '--modes <values...>' argument 'c' is invalid. Allowed choices are a, b.\n",
			stdout: "",
		});
		const badSize = await run(["--level", "1", "--sizes", "3"]);
		expect(badSize.stderr).toContain("Allowed choices are 1, 2.");
	});

	it("requires a required path flag, and names it in --help as required", async () => {
		const missing = await cliRun(["foo", "get"], {
			env: { ACME_APP_URL: url },
		});
		expect(missing).toEqual({
			code: 1,
			stderr: "error: required option '--id <value>' not specified\n",
			stdout: "",
		});
		const help = await cliRun(["foo", "get", "--help"]);
		expect(help.stdout.replace(/\s+/g, " ")).toContain(
			"--id <value> id (path, required)",
		);
	});
});

describe("cliCreate in process: the response", () => {
	const document: CliDocument = {
		paths: {
			"/a": { get: { operationId: "aGet", tags: ["a"] } },
		},
	};
	const answer = (response: unknown) =>
		cliRun(["a", "get"], {
			document,
			env: { ACME_APP_URL: url },
			operations: { aGet: async () => response },
		});

	it("prints a Problem's title and code, or its title alone", async () => {
		expect(
			await answer({
				data: { code: "Taken", title: "Conflict" },
				status: 409,
			}),
		).toEqual({ code: 1, stderr: "Conflict: Taken\n", stdout: "" });
		expect(await answer({ data: { title: "Conflict" }, status: 409 })).toEqual({
			code: 1,
			stderr: "Conflict\n",
			stdout: "",
		});
		expect(
			await answer({ data: { code: "", title: "Conflict" }, status: 409 }),
		).toEqual({ code: 1, stderr: "Conflict\n", stdout: "" });
	});

	it("prints HTTP, the status and the body for an error that is not a Problem", async () => {
		expect(await answer({ data: { message: "no" }, status: 500 })).toEqual({
			code: 1,
			stderr: 'HTTP 500 {"message":"no"}\n',
			stdout: "",
		});
		expect(await answer({ data: { title: 5 }, status: 400 })).toEqual({
			code: 1,
			stderr: 'HTTP 400 {"title":5}\n',
			stdout: "",
		});
		expect(await answer({ status: 404 })).toEqual({
			code: 1,
			stderr: "HTTP 404 null\n",
			stdout: "",
		});
		expect(await answer({ data: null, status: 404 })).toEqual({
			code: 1,
			stderr: "HTTP 404 null\n",
			stdout: "",
		});
		expect(await answer({ data: "bad", status: 400 })).toEqual({
			code: 1,
			stderr: 'HTTP 400 "bad"\n',
			stdout: "",
		});
	});

	it("treats a status below 400 as success, and a response without a numeric status as a failure", async () => {
		expect(await answer({ data: { ok: 1 }, status: 399 })).toEqual({
			code: 0,
			stderr: "",
			stdout: '{\n  "ok": 1\n}\n',
		});
		expect(await answer({ data: { ok: 1 }, status: 400 })).toMatchObject({
			code: 1,
		});
		expect(await answer({ data: { ok: 1 }, status: "200" })).toEqual({
			code: 1,
			stderr: 'HTTP 200 {"ok":1}\n',
			stdout: "",
		});
		expect(await answer(undefined)).toEqual({
			code: 1,
			stderr: "HTTP undefined null\n",
			stdout: "",
		});
		expect(await answer(null)).toEqual({
			code: 1,
			stderr: "HTTP undefined null\n",
			stdout: "",
		});
	});

	it("prints nothing for a success without a body, and prints falsy bodies that are data", async () => {
		for (const data of [undefined, null, ""]) {
			expect(await answer({ data, status: 204 })).toEqual({
				code: 0,
				stderr: "",
				stdout: "",
			});
		}
		for (const [data, text] of [
			[0, "0"],
			[false, "false"],
			[[], "[]"],
		] as const) {
			expect(await answer({ data, status: 200 })).toEqual({
				code: 0,
				stderr: "",
				stdout: `${text}\n`,
			});
		}
	});

	it("prints the message of an Error an operation throws, and the text of anything else", async () => {
		const thrown = (value: unknown) =>
			cliRun(["a", "get"], {
				document,
				env: { ACME_APP_URL: url },
				operations: {
					aGet: async () => {
						throw value;
					},
				},
			});
		expect(await thrown(new Error("boom"))).toEqual({
			code: 1,
			stderr: "boom\n",
			stdout: "",
		});
		expect(await thrown("plain")).toEqual({
			code: 1,
			stderr: "plain\n",
			stdout: "",
		});
	});
});

describe("cliCreate in process: the base URL", () => {
	const baseUrlOf = async (args: string[], env: Record<string, string>) =>
		(
			argsOf(await cliRun(["foo", "get", "--id", "1", ...args], { env })) as [
				string,
				{ baseUrl: string },
			]
		)[1].baseUrl;
	const production = "https://api.acme.example";

	it("picks the URL from --url, else --env, else ACME_APP_URL, else ACME_APP_ENV", async () => {
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
			await baseUrlOf(["--env", "development"], { ACME_APP_ENV: "production" }),
		).toBe(url);
		expect(
			await baseUrlOf(["--env", "production", "--url", `${url}/`], {}),
		).toBe(url);
		expect(
			await baseUrlOf(["--url", `${url}//`], { ACME_APP_ENV: "production" }),
		).toBe(url);
	});

	it("ignores an empty ACME_APP_URL or ACME_APP_ENV", async () => {
		expect(
			await baseUrlOf([], { ACME_APP_ENV: "production", ACME_APP_URL: "" }),
		).toBe(production);
		const emptyBoth = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_ENV: "", ACME_APP_URL: "" },
		});
		expect(emptyBoth.stderr).toMatch(/^Pick an environment with --env/);
	});

	it("exits 1 naming the environments without one, or with an unknown one", async () => {
		const none = await cliRun(["foo", "get", "--id", "1"]);
		expect(none).toEqual({
			code: 1,
			stderr:
				"Pick an environment with --env or ACME_APP_ENV (development, production), or set a URL with --url or ACME_APP_URL.\n",
			stdout: "",
		});
		const unknown = await cliRun(["foo", "get", "--id", "1", "--env", "dev"], {
			env: { ACME_APP_URL: url },
		});
		expect(unknown).toEqual({
			code: 1,
			stderr: "No environment dev: pick one of development, production.\n",
			stdout: "",
		});
		const unlisted = await cliRun(["foo", "get", "--id", "1"], {
			document: {
				...cliTestDocument,
				servers: [
					{ description: "development", url: "/" },
					{ description: "eu", url: "https://{region}.acme.example" },
					{ url: "https://api.acme.example" },
				],
			},
			env: { ACME_APP_ENV: "development" },
		});
		expect(unlisted.stderr).toBe(
			"No environment development: pick one of none: use a URL.\n",
		);
		const { servers: _servers, ...withoutServers } = cliTestDocument;
		const noServers = await cliRun(["foo", "get", "--id", "1"], {
			document: withoutServers,
		});
		expect(noServers.stderr).toBe(
			"Pick an environment with --env or ACME_APP_ENV (none: use a URL), or set a URL with --url or ACME_APP_URL.\n",
		);
	});

	it("exits 1 for an empty --env or --url, rather than falling through to the env vars", async () => {
		const env = { ACME_APP_ENV: "production", ACME_APP_URL: url };
		expect(
			await cliRun(["foo", "get", "--id", "1", "--env", ""], { env }),
		).toEqual({ code: 1, stderr: "--env needs a value.\n", stdout: "" });
		expect(
			await cliRun(["foo", "get", "--id", "1", "--url", ""], { env }),
		).toEqual({ code: 1, stderr: "--url needs a value.\n", stdout: "" });
	});

	it("derives the env var prefix from the command's name", async () => {
		const run = await cliRun(["foo", "get", "--id", "1"], {
			env: { FANTASY_GOLF_URL: url },
			name: "fantasy-golf",
		});
		expect(argsOf(run)).toEqual(["1", { baseUrl: url }]);
		const camel = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_ENV: "development" },
			name: "acmeApp",
		});
		expect(argsOf(camel)).toEqual(["1", { baseUrl: url }]);
	});
});

describe("cliCreate in process: --help", () => {
	it("lists the groups, the environments and login in the root --help", async () => {
		const root = await cliRun(["--help"]);
		expect(root.code).toBe(0);
		expect(root.stderr).toBe("");
		expect(root.stdout).toMatch(/^Usage: acme-app \[options\] \[command\]/);
		expect(root.stdout).toContain("acme-app");
		expect(root.stdout).toMatch(/foo\s+Foos and their names/);
		expect(root.stdout).toMatch(/invoice-line\s+customer-assign/);
		expect(root.stdout).toMatch(/login \[options\]\s+Sign in a machine client/);
		const flat = root.stdout.replace(/\s+/g, " ");
		expect(flat).toContain(
			"--env <name> the environment (default ACME_APP_ENV): development, production",
		);
		expect(flat).toContain(
			"--url <url> a base URL that beats --env, for tests and one-off servers (default ACME_APP_URL, which --env beats)",
		);
		expect(flat).toContain(
			"--token <token> the bearer token (default ACME_APP_TOKEN, then the stored login)",
		);
	});

	it("describes the program by the document's description, else its title, else its name", async () => {
		const described = await cliRun(["--help"], {
			document: {
				...cliTestDocument,
				info: { description: "The acme API", title: "Acme" },
			},
		});
		expect(described.stdout).toContain("The acme API");
		const titled = await cliRun(["--help"], {
			document: {
				...cliTestDocument,
				info: { description: "", title: "Acme" },
			},
		});
		expect(titled.stdout).toMatch(/\n\s*Acme\n/);
		const { info: _info, ...withoutInfo } = cliTestDocument;
		const bare = await cliRun(["--help"], {
			document: withoutInfo,
		});
		expect(bare.stdout).toMatch(/\n\s*acme-app\n/);
	});

	it("shows a group's commands with their summaries, and a command's own description", async () => {
		const foo = await cliRun(["foo", "--help"]);
		expect(foo.stdout).toMatch(/Foos and their names/);
		expect(foo.stdout).toMatch(/create \[options\]\s+Create a foo/);
		expect(foo.stdout).toMatch(/get \[options\]\s+Read a foo/);
		const create = await cliRun(["foo", "create", "--help"]);
		expect(create.stdout).toContain("Create a foo with a unique name.");
		expect(create.stdout).toContain("--name <value>");
		expect(create.stdout).toContain("--data <json>");
		expect(create.stdout).toContain("the body as JSON, or @file.json");
		expect(create.stdout).toContain("--no-draft");
		const get = await cliRun(["foo", "get", "--help"]);
		expect(get.stdout).not.toContain("--data");
		const flat = (await cliRun(["foo", "update", "--help"])).stdout.replace(
			/\s+/g,
			" ",
		);
		expect(flat).toContain("--ids <values...> ids (body)");
	});

	it("lists a group's command names when its tag has no description", async () => {
		const group = await cliRun(["invoice-line", "--help"]);
		expect(group.stdout).toMatch(/Usage: acme-app invoice-line/);
		expect(group.stdout).toMatch(/customer-assign/);
		const root = await cliRun(["--help"]);
		expect(root.stdout).toMatch(/invoice-line\s+customer-assign\n/);
	});

	it("shows each flag's description, allowed values and default", async () => {
		const help = (await cliRun(["foo", "list", "--help"])).stdout.replace(
			/\s+/g,
			" ",
		);
		expect(help).toContain(
			"--sort <value> sort (query): The order of the page (choices: createdAt, -createdAt, name, -name) (default: -createdAt)",
		);
		expect(help).toContain(
			"--count count (query): Count every match (default: false)",
		);
		expect(help).toContain("--limit <value> limit (query)");
		expect(help).toContain("--no-count");
	});

	it("shows a default that is not text as JSON, and wraps a description onto one line", async () => {
		const document: CliDocument = {
			paths: {
				"/a": {
					get: {
						operationId: "aGet",
						parameters: [
							{
								description: "Many\n   lines   of text ",
								in: "query",
								name: "tags",
								schema: {
									default: ["x", "y"],
									items: { type: "string" },
									type: "array",
								},
							},
						],
						tags: ["a"],
					},
				},
			},
		};
		const help = await cliRun(["a", "get", "--help"], {
			document,
			operations: { aGet: async () => ({ status: 200 }) },
		});
		expect(help.stdout.replace(/\s+/g, " ")).toContain(
			'--tags <values...> tags (query): Many lines of text (default: ["x","y"])',
		);
	});

	it("shows the login options, global ones included", async () => {
		const login = await cliRun(["login", "--help"]);
		expect(login.stdout).toContain("--client-id <id>");
		expect(login.stdout).toContain("the machine client's id");
		expect(login.stdout).toContain("--scope <scopes...>");
		expect(login.stdout).toContain("scopes to ask for (default all)");
		expect(login.stdout).toContain("--env <name>");
		expect(login.stdout.replace(/\s+/g, " ")).toContain(
			"The client secret comes from ACME_APP_CLIENT_SECRET or stdin.",
		);
	});

	it("exits 1 for an unknown command or option, and 0 after help", async () => {
		const unknown = await cliRun(["nope"]);
		expect(unknown.code).toBe(1);
		expect(unknown.stderr).toContain("unknown command 'nope'");
		const option = await cliRun(["foo", "get", "--id", "1", "--bogus"]);
		expect(option.code).toBe(1);
		expect(option.stderr).toContain("unknown option '--bogus'");
	});
});

describe("cliCreate in process: the token", () => {
	it("sends --token, else ACME_APP_TOKEN, and no token when neither is set", async () => {
		const flag = await cliRun(["foo", "get", "--id", "1", "--token", "f"], {
			env: { ACME_APP_TOKEN: "env", ACME_APP_URL: url },
		});
		expect(argsOf(flag)).toEqual(["1", { baseUrl: url, token: "f" }]);
		const fromEnv = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_TOKEN: "env", ACME_APP_URL: url },
		});
		expect(argsOf(fromEnv)).toEqual(["1", { baseUrl: url, token: "env" }]);
		const none = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_TOKEN: "", ACME_APP_URL: url },
		});
		expect(argsOf(none)).toEqual(["1", { baseUrl: url }]);
		const emptyFlag = await cliRun(["foo", "get", "--id", "1", "--token", ""], {
			env: { ACME_APP_TOKEN: "env", ACME_APP_URL: url },
		});
		expect(argsOf(emptyFlag)).toEqual(["1", { baseUrl: url, token: "" }]);
	});
});

describe("cliCreate", () => {
	it("throws a TypeError naming the missing operation, before any command runs", () => {
		const { fooList: _, ...operations } = cliTestOperations;
		expect(() =>
			cliCreate({ document: cliTestDocument, name: "acme-app", operations }),
		).toThrow(
			new TypeError(
				"cliCreate: operations has no fooList; regenerate the SDK from this document",
			),
		);
		expect(() =>
			cliCreate({
				document: cliTestDocument,
				name: "acme-app",
				operations: { ...cliTestOperations, fooGet: undefined as never },
			}),
		).toThrow("cliCreate: operations has no fooGet");
	});
});

describe("login in process", () => {
	const requests: {
		body: string;
		method?: string;
		origin?: string;
		path?: string;
	}[] = [];
	const future = () => new Date(Date.now() + 3_600_000).toISOString();
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			requests.push({
				body,
				...(req.method === undefined ? {} : { method: req.method }),
				...(req.headers.origin === undefined
					? {}
					: { origin: req.headers.origin }),
				...(req.url === undefined ? {} : { path: req.url }),
			});
			const id = new URLSearchParams(body).get("client_id");
			const reply = (status: number, payload: string) => {
				res.writeHead(status, { "content-type": "application/json" });
				res.end(payload);
			};
			const token = { access_token: "stored", expires_in: 300 };
			if (id === "ci") reply(200, JSON.stringify(token));
			else if (id === "created") reply(201, JSON.stringify(token));
			else if (id === "redirect") reply(300, JSON.stringify(token));
			else if (id === "no-token")
				reply(200, JSON.stringify({ expires_in: 300 }));
			else if (id === "no-expiry")
				reply(200, JSON.stringify({ access_token: "x" }));
			else if (id === "text-token")
				reply(200, JSON.stringify({ access_token: 5, expires_in: 300 }));
			else if (id === "text-expiry")
				reply(200, JSON.stringify({ access_token: "x", expires_in: "300" }));
			else if (id === "html") reply(200, "<html>");
			else if (id === "array") reply(200, "[1]");
			else if (id === "null") reply(200, "null");
			else if (id === "plain") reply(500, JSON.stringify({ message: "x" }));
			else if (id === "numeric-error") reply(400, JSON.stringify({ error: 5 }));
			else reply(401, JSON.stringify({ error: "invalid_client" }));
		});
	});
	let base: string;

	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
	});

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve));
	});

	const home = async (label: string): Promise<string> => {
		const path = join(config, label);
		await mkdir(path, { recursive: true });
		return path;
	};
	const fileOf = (dir: string) => join(dir, "acme-app", "login.json");

	it("posts the client credentials form with the Origin, and stores the token with mode 600", async () => {
		const dir = await home("stores");
		const before = Date.now();
		const run = await cliRun(["login", "--client-id", "ci"], {
			env: {
				ACME_APP_CLIENT_SECRET: "s3cret",
				ACME_APP_URL: `${base}/`,
				XDG_CONFIG_HOME: dir,
			},
		});
		const file = fileOf(dir);
		expect(run).toEqual({
			code: 0,
			stderr: `Logged in. The token is in ${file}\n`,
			stdout: "",
		});
		const sent = requests.at(-1);
		expect(sent).toMatchObject({
			method: "POST",
			origin: base,
			path: "/auth/token",
		});
		expect(Object.fromEntries(new URLSearchParams(sent?.body))).toEqual({
			client_id: "ci",
			client_secret: "s3cret",
			grant_type: "client_credentials",
		});
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect((await stat(join(dir, "acme-app"))).mode & 0o777).toBe(0o700);
		expect(await readdir(join(dir, "acme-app"))).toEqual(["login.json"]);
		const stored = JSON.parse(await readFile(file, "utf8"));
		expect(Object.keys(stored)).toEqual([base]);
		expect(stored[base].token).toBe("stored");
		const expiresAt = Date.parse(stored[base].expiresAt);
		expect(expiresAt).toBeGreaterThanOrEqual(before + 299_000);
		expect(expiresAt).toBeLessThanOrEqual(Date.now() + 301_000);
	});

	it("sends the stored token to the URL it came from, and to no other", async () => {
		const dir = await home("sends");
		await cliRun(["login", "--client-id", "ci"], {
			env: { ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		const get = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		expect(argsOf(get)).toEqual(["1", { baseUrl: base, token: "stored" }]);
		const elsewhere = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_URL: url, XDG_CONFIG_HOME: dir },
		});
		expect(argsOf(elsewhere)).toEqual(["1", { baseUrl: url }]);
		const flag = await cliRun(["foo", "get", "--id", "1", "--token", "f"], {
			env: { ACME_APP_TOKEN: "env", ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		expect(argsOf(flag)).toEqual(["1", { baseUrl: base, token: "f" }]);
		const fromEnv = await cliRun(["foo", "get", "--id", "1"], {
			env: { ACME_APP_TOKEN: "env", ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		expect(argsOf(fromEnv)).toEqual(["1", { baseUrl: base, token: "env" }]);
	});

	it("sends no client secret without one, and the scopes joined by spaces", async () => {
		const dir = await home("scopes");
		await cliRun(["login", "--client-id", "ci", "--scope", "read", "write"], {
			env: { ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		expect(
			Object.fromEntries(new URLSearchParams(requests.at(-1)?.body)),
		).toEqual({
			client_id: "ci",
			grant_type: "client_credentials",
			scope: "read write",
		});
		await cliRun(["login", "--client-id", "ci"], {
			env: {
				ACME_APP_CLIENT_SECRET: "",
				ACME_APP_URL: base,
				XDG_CONFIG_HOME: dir,
			},
		});
		expect(
			Object.fromEntries(new URLSearchParams(requests.at(-1)?.body)),
		).toEqual({ client_id: "ci", grant_type: "client_credentials" });
	});

	it("accepts any 2xx answer, and refuses the rest with the app's error", async () => {
		const dir = await home("statuses");
		const env = { ACME_APP_URL: base, XDG_CONFIG_HOME: dir };
		const created = await cliRun(["login", "--client-id", "created"], { env });
		expect(created.code).toBe(0);
		const redirect = await cliRun(["login", "--client-id", "redirect"], {
			env,
		});
		expect(redirect).toEqual({
			code: 1,
			stderr: `login failed: POST ${base}/auth/token answered 300\n`,
			stdout: "",
		});
		const refused = await cliRun(["login", "--client-id", "nope"], { env });
		expect(refused.stderr).toBe(
			`login failed: POST ${base}/auth/token answered 401 invalid_client\n`,
		);
		for (const id of ["plain", "numeric-error", "null", "array"]) {
			const run = await cliRun(["login", "--client-id", id], { env });
			expect(run.code).toBe(1);
		}
		expect(
			(await cliRun(["login", "--client-id", "plain"], { env })).stderr,
		).toBe(`login failed: POST ${base}/auth/token answered 500\n`);
		expect(
			(await cliRun(["login", "--client-id", "numeric-error"], { env })).stderr,
		).toBe(`login failed: POST ${base}/auth/token answered 400\n`);
	});

	it("refuses an answer without a text token and a numeric expiry, and stores nothing", async () => {
		const dir = await home("incomplete");
		const env = { ACME_APP_URL: base, XDG_CONFIG_HOME: dir };
		for (const id of ["no-token", "no-expiry", "text-token", "text-expiry"]) {
			const run = await cliRun(["login", "--client-id", id], { env });
			expect(run).toEqual({
				code: 1,
				stderr: `login failed: POST ${base}/auth/token answered 200\n`,
				stdout: "",
			});
		}
		await expect(stat(fileOf(dir))).rejects.toThrow("ENOENT");
	});

	it("exits 1 saying the answer is not JSON", async () => {
		const dir = await home("html");
		const run = await cliRun(["login", "--client-id", "html"], {
			env: { ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		expect(run).toEqual({
			code: 1,
			stderr: `login failed: POST ${base}/auth/token answered with a body that is not JSON\n`,
			stdout: "",
		});
	});

	it("logs in only over https or to this machine", async () => {
		const dir = await home("https");
		for (const target of [
			"http://example.com",
			"http://localhost.example.com",
		]) {
			const run = await cliRun(["login", "--client-id", "ci"], {
				env: { ACME_APP_URL: target, XDG_CONFIG_HOME: dir },
			});
			expect(run).toEqual({
				code: 1,
				stderr: `login failed: ${target} is not https, so the client secret would travel in the clear\n`,
				stdout: "",
			});
		}
		const local = await cliRun(["login", "--client-id", "ci"], {
			env: {
				ACME_APP_URL: base.replace("127.0.0.1", "localhost"),
				XDG_CONFIG_HOME: dir,
			},
		});
		expect(local.code).toBe(0);
		const v6 = await cliRun(["login", "--client-id", "ci"], {
			env: { ACME_APP_URL: "http://[::1]:1", XDG_CONFIG_HOME: dir },
		});
		expect(v6.stderr).toMatch(
			/^login failed: POST http:\/\/\[::1\]:1\/auth\/token got no answer: /,
		);
	});

	it("exits 1 with the reason when nothing listens at the URL", async () => {
		const closed = createServer();
		await new Promise<void>((resolve) =>
			closed.listen(0, "127.0.0.1", resolve),
		);
		const address = closed.address();
		const port = typeof address === "object" && address ? address.port : 0;
		await new Promise((resolve) => closed.close(resolve));
		const run = await cliRun(["login", "--client-id", "ci"], {
			env: { ACME_APP_URL: `http://127.0.0.1:${port}` },
		});
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(
			`login failed: POST http://127.0.0.1:${port}/auth/token got no answer: `,
		);
		expect(run.stderr).toMatch(/\(.*ECONNREFUSED.*\)\n$/);
	});

	it("ignores a login file it cannot use, and an expired or unusable login", async () => {
		const dir = await home("unusable");
		const file = fileOf(dir);
		await mkdir(join(file, ".."), { recursive: true });
		const env = { ACME_APP_URL: base, XDG_CONFIG_HOME: dir };
		const token = async () =>
			(
				argsOf(await cliRun(["foo", "get", "--id", "1"], { env })) as [
					string,
					{ token?: string },
				]
			)[1].token;
		for (const stored of [
			"{bad",
			"null",
			"[]",
			"7",
			JSON.stringify({ [base]: null }),
			JSON.stringify({ [base]: { token: "t" } }),
			JSON.stringify({ [base]: { expiresAt: "soon", token: "t" } }),
			JSON.stringify({
				[base]: { expiresAt: "2020-01-01T00:00:00Z", token: "t" },
			}),
			JSON.stringify({ [base]: { expiresAt: future(), token: 5 } }),
			JSON.stringify({ expiresAt: future(), token: "t", url: base }),
		]) {
			await writeFile(file, stored);
			expect(await token()).toBeUndefined();
		}
		await writeFile(
			file,
			JSON.stringify({ [base]: { expiresAt: future(), token: "kept" } }),
		);
		expect(await token()).toBe("kept");
		const login = await cliRun(["login", "--client-id", "ci"], { env });
		expect(login.code).toBe(0);
		await writeFile(file, "{bad");
		await cliRun(["login", "--client-id", "ci"], { env });
		expect(JSON.parse(await readFile(file, "utf8"))[base].token).toBe("stored");
	});

	it("keeps a login per URL, and drops the expired ones when it writes", async () => {
		const dir = await home("per-url");
		const file = fileOf(dir);
		await mkdir(join(file, ".."), { recursive: true });
		await writeFile(
			file,
			JSON.stringify({
				"http://old.example": { expiresAt: "2020-01-01T00:00:00Z", token: "o" },
				"http://other.example": { expiresAt: future(), token: "other" },
			}),
		);
		await cliRun(["login", "--client-id", "ci"], {
			env: { ACME_APP_URL: base, XDG_CONFIG_HOME: dir },
		});
		const stored = JSON.parse(await readFile(file, "utf8"));
		expect(Object.keys(stored).sort()).toEqual([base, "http://other.example"]);
		expect(stored["http://other.example"].token).toBe("other");
	});

	it("logs in to the environment --env names, and keeps nothing for a refused one", async () => {
		const dir = await home("env");
		const document = {
			...cliTestDocument,
			servers: [{ description: "development", url: `${base}/` }],
		};
		const run = await cliRun(
			["login", "--env", "development", "--client-id", "ci"],
			{ document, env: { XDG_CONFIG_HOME: dir } },
		);
		expect(run.code).toBe(0);
		expect(
			Object.keys(JSON.parse(await readFile(fileOf(dir), "utf8"))),
		).toEqual([base]);
		const unknown = await cliRun(
			["login", "--env", "mars", "--client-id", "ci"],
			{
				document,
				env: { XDG_CONFIG_HOME: dir },
			},
		);
		expect(unknown.stderr).toBe(
			"No environment mars: pick one of development.\n",
		);
		const missing = await cliRun(["login"], { env: { ACME_APP_URL: base } });
		expect(missing).toEqual({
			code: 1,
			stderr: "error: required option '--client-id <id>' not specified\n",
			stdout: "",
		});
	});

	it("keeps its file in XDG_CONFIG_HOME, else under the home directory", async () => {
		// A name of its own, so the real home directory gets a directory this test removes.
		const name = `cli-inprocess-${process.pid}`;
		const where = join(homedir(), ".config", name);
		try {
			const run = await cliRun(["login", "--client-id", "ci"], {
				env: { [`${cliEnvPrefix(name)}_URL`]: base, XDG_CONFIG_HOME: "" },
				name,
			});
			if (process.platform === "linux") {
				expect(run.stderr).toBe(
					`Logged in. The token is in ${join(where, "login.json")}\n`,
				);
			} else {
				expect(run.code).toBe(0);
			}
		} finally {
			await rm(where, { force: true, recursive: true });
		}
	});
});

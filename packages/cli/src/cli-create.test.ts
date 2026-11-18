import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliCreate } from "./cli-create.ts";
import { cliTestDocument, cliTestOperations } from "./cli-test-app.ts";

const app = join(import.meta.dirname, "cli-test-app.ts");
const url = "http://127.0.0.1:1";
let config: string;

// Runs the fixture CLI as its own process, with a config directory of its own.
const cliRun = async (
	args: string[],
	env: Record<string, string> = {},
	stdin?: string,
) => {
	const run = promisify(execFile)(process.execPath, [app, ...args], {
		env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: config, ...env },
	});
	run.child.stdin?.end(stdin ?? "");
	return run.then(
		({ stdout, stderr }) => ({ code: 0, stderr, stdout }),
		(error: { code: number; stderr: string; stdout: string }) => ({
			code: error.code,
			stderr: error.stderr,
			stdout: error.stdout,
		}),
	);
};

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

	it("exits 1 without a base URL or a required path field", async () => {
		const noUrl = await cliRun(["foo", "get", "--id", "1"]);
		expect(noUrl).toMatchObject({
			code: 1,
			stderr: "Set the API's URL with --url or ACME_APP_URL.\n",
		});
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
		const foo = await cliRun(["foo", "--help"]);
		expect(foo.stdout).toMatch(/create \[options\]\s+Create a foo/);
		expect(foo.stdout).toMatch(/get \[options\]\s+Read a foo/);
		const create = await cliRun(["foo", "create", "--help"]);
		expect(create.stdout).toContain("Create a foo with a unique name.");
		expect(create.stdout).toContain("--name <value>");
	});

	it("throws when operations lacks one of the document's operations", () => {
		const { fooGet: _, ...operations } = cliTestOperations;
		expect(() =>
			cliCreate({ document: cliTestDocument, name: "acme-app", operations }),
		).toThrow("cliCreate: operations has no fooGet");
	});
});

describe("login", () => {
	const requests: { body: string; origin: string | undefined }[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			requests.push({ body, origin: req.headers.origin });
			const known = new URLSearchParams(body).get("client_id") === "ci";
			res.writeHead(known ? 200 : 401, { "content-type": "application/json" });
			res.end(
				JSON.stringify(
					known
						? { access_token: "stored", expires_in: 300, token_type: "Bearer" }
						: { error: "invalid_client" },
				),
			);
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

	it("stores a token with mode 600, and a later command sends it", async () => {
		const login = await cliRun(["login", "--client-id", "ci"], {
			ACME_APP_CLIENT_SECRET: "s3cret",
			ACME_APP_URL: base,
		});
		expect(login.code).toBe(0);
		expect(
			Object.fromEntries(new URLSearchParams(requests.at(-1)?.body)),
		).toEqual({
			client_id: "ci",
			client_secret: "s3cret",
			grant_type: "client_credentials",
		});
		expect(requests.at(-1)?.origin).toBe(base);
		const file = join(config, "acme-app", "login.json");
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
			token: "stored",
			url: base,
		});

		const get = await cliRun(["foo", "get", "--id", "1"], {
			ACME_APP_URL: base,
		});
		expect(JSON.parse(get.stdout).args).toEqual([
			"1",
			{ baseUrl: base, token: "stored" },
		]);
	});

	it("lets <NAME>_TOKEN and --token win over the stored login, and keeps it to its URL", async () => {
		await cliRun(["login", "--client-id", "ci"], { ACME_APP_URL: base });
		const fromEnv = await cliRun(["foo", "get", "--id", "1"], {
			ACME_APP_TOKEN: "env",
			ACME_APP_URL: base,
		});
		expect(JSON.parse(fromEnv.stdout).args[1]).toEqual({
			baseUrl: base,
			token: "env",
		});
		const fromFlag = await cliRun(["foo", "get", "--id", "1", "--token", "f"], {
			ACME_APP_TOKEN: "env",
			ACME_APP_URL: base,
		});
		expect(JSON.parse(fromFlag.stdout).args[1].token).toBe("f");
		const elsewhere = await cliRun(["foo", "get", "--id", "1"], {
			ACME_APP_URL: url,
		});
		expect(JSON.parse(elsewhere.stdout).args[1]).toEqual({ baseUrl: url });
	});

	it("reads the client secret from stdin", async () => {
		await cliRun(
			["login", "--client-id", "ci"],
			{ ACME_APP_URL: base },
			"piped\n",
		);
		expect(
			new URLSearchParams(requests.at(-1)?.body).get("client_secret"),
		).toBe("piped");
	});

	it("exits 1 and stores nothing new when the app refuses the client", async () => {
		const { code, stderr } = await cliRun(["login", "--client-id", "nope"], {
			ACME_APP_URL: base,
			XDG_CONFIG_HOME: join(config, "refused"),
		});
		expect(code).toBe(1);
		expect(stderr).toBe(
			`login failed: POST ${base}/auth/token answered 401 invalid_client\n`,
		);
		await expect(stat(join(config, "refused"))).rejects.toThrow("ENOENT");
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

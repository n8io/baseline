import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliCreate } from "./cli.ts";
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
			[base]: { token: "stored" },
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

	it("reads the client secret from a shell pipe, and never waits on an open stdin", async () => {
		// cliRun's stdin is a socket the parent holds: login must not read it.
		await cliRun(["login", "--client-id", "ci"], { ACME_APP_URL: base }, "x");
		expect(
			new URLSearchParams(requests.at(-1)?.body).has("client_secret"),
		).toBe(false);
		await promisify(execFile)(
			"sh",
			[
				"-c",
				`printf 'piped\\n' | "$0" "$1" login --client-id ci`,
				process.execPath,
				app,
			],
			{ env: { ACME_APP_URL: base, XDG_CONFIG_HOME: config } },
		);
		expect(
			new URLSearchParams(requests.at(-1)?.body).get("client_secret"),
		).toBe("piped");
	});

	it("sends no expired token, and logs in only over https or to this machine", async () => {
		const home = join(config, "expired");
		const file = join(home, "acme-app", "login.json");
		await mkdir(join(file, ".."), { recursive: true });
		await writeFile(
			file,
			JSON.stringify({
				[url]: { expiresAt: "2020-01-01T00:00:00Z", token: "old" },
			}),
		);
		const get = await cliRun(["foo", "get", "--id", "1"], {
			ACME_APP_URL: url,
			XDG_CONFIG_HOME: home,
		});
		expect(JSON.parse(get.stdout).args[1]).toEqual({ baseUrl: url });
		const plain = await cliRun(["login", "--client-id", "ci"], {
			ACME_APP_URL: "http://example.com",
		});
		expect(plain).toMatchObject({
			code: 1,
			stderr:
				"login failed: http://example.com is not https, so the client secret would travel in the clear\n",
		});
	});

	it("logs in over a login.json it cannot read", async () => {
		const home = join(config, "corrupt");
		const file = join(home, "acme-app", "login.json");
		await mkdir(join(file, ".."), { recursive: true });
		await writeFile(file, "{bad");
		const login = await cliRun(["login", "--client-id", "ci"], {
			ACME_APP_URL: base,
			XDG_CONFIG_HOME: home,
		});
		expect(login.code).toBe(0);
		expect(JSON.parse(await readFile(file, "utf8"))[base].token).toBe("stored");
	});

	it("keeps a login per environment, and drops an older file's single login", async () => {
		const home = join(config, "environments");
		const file = join(home, "acme-app", "login.json");
		await mkdir(join(file, ".."), { recursive: true });
		const expiresAt = new Date(Date.now() + 60_000).toISOString();
		await writeFile(file, JSON.stringify({ expiresAt, token: "old", url }));
		// One server under two names, so two environments with two URLs.
		const local = base.replace("127.0.0.1", "localhost");
		const env = {
			CLI_TEST_SERVERS: JSON.stringify([
				{ description: "development", url: base },
				{ description: "staging", url: `${local}/` },
			]),
			XDG_CONFIG_HOME: home,
		};
		const old = await cliRun(["foo", "get", "--id", "1"], {
			...env,
			ACME_APP_URL: url,
		});
		expect(JSON.parse(old.stdout).args[1]).toEqual({ baseUrl: url });
		for (const name of ["development", "staging"]) {
			const login = await cliRun(
				["login", "--env", name, "--client-id", "ci"],
				env,
			);
			expect(login.code).toBe(0);
		}
		expect(requests.at(-1)?.origin).toBe(local);
		expect(
			Object.keys(JSON.parse(await readFile(file, "utf8"))).sort(),
		).toEqual([base, local]);
		const staging = await cliRun(
			["foo", "get", "--id", "1", "--env", "staging"],
			env,
		);
		expect(JSON.parse(staging.stdout).args[1]).toEqual({
			baseUrl: local,
			token: "stored",
		});
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

describe("login without an answer", () => {
	// Takes each request and never answers it.
	const silent = createServer(() => {});
	let base: string;

	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			silent.listen(0, "127.0.0.1", resolve),
		);
		const address = silent.address();
		base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
	});

	afterAll(async () => {
		silent.closeAllConnections();
		await new Promise((resolve) => silent.close(resolve));
	});

	it("exits 1 with the reason when nothing listens at the URL", async () => {
		const closed = createServer();
		await new Promise<void>((resolve) =>
			closed.listen(0, "127.0.0.1", resolve),
		);
		const address = closed.address();
		const port = typeof address === "object" && address ? address.port : 0;
		await new Promise((resolve) => closed.close(resolve));
		const { code, stderr } = await cliRun(["login", "--client-id", "ci"], {
			ACME_APP_URL: `http://127.0.0.1:${port}`,
		});
		expect(code).toBe(1);
		expect(stderr).toMatch(
			`login failed: POST http://127.0.0.1:${port}/auth/token got no answer:`,
		);
		expect(stderr).toMatch("ECONNREFUSED");
	});

	it("gives up after the SDK's 10 s timeout and sends the token request once", async () => {
		let received = 0;
		silent.on("request", () => {
			received += 1;
		});
		const { code, stderr } = await cliRun(["login", "--client-id", "ci"], {
			ACME_APP_URL: base,
		});
		expect(code).toBe(1);
		expect(stderr).toBe(
			`login failed: POST ${base}/auth/token got no answer: The SDK call timed out\n`,
		);
		expect(received).toBe(1);
	}, 20_000);
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

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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliTestProcessRun } from "./cli-test-process.ts";

const app = join(import.meta.dirname, "cli-test-app.ts");
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

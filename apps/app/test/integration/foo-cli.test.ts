import { execFile } from "node:child_process";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";

// The Project's CLI as its users run it, against the production build on memory adapters.
let server: ProductionServer;
const config = mkdtempDisposableSync(join(tmpdir(), "foo-cli-"));

// Without the shell's APP_URL, APP_TOKEN and APP_CLIENT_SECRET, and with a login store of its own.
const cliEnv: NodeJS.ProcessEnv = {
	...process.env,
	XDG_CONFIG_HOME: config.path,
};
for (const name of ["APP_URL", "APP_TOKEN", "APP_CLIENT_SECRET"]) {
	delete cliEnv[name as keyof typeof cliEnv];
}

const cli = async (args: string[]) => {
	try {
		const { stderr, stdout } = await promisify(execFile)(
			"node",
			["clients/cli/cli.ts", ...args, "--url", server.url],
			{ env: cliEnv },
		);
		return { code: 0, stderr, stdout };
	} catch (error) {
		const { code, stderr, stdout } = error as {
			code: number;
			stderr: string;
			stdout: string;
		};
		return { code, stderr, stdout };
	}
};

beforeAll(async () => {
	server = await productionServerStart({ databaseUrl: "memory://" });
}, 30_000);

afterAll(async () => {
	await server?.stop();
	config[Symbol.dispose]();
});

describe("the CLI on the production build", { timeout: 30_000 }, () => {
	it("signs in, creates a Foo and lists it", async () => {
		expect(await cli(["foo", "list"])).toMatchObject({ code: 1 });

		expect(await cli(["login", "--client-id", "dev-client"])).toMatchObject({
			code: 0,
		});

		const created = await cli(["foo", "create", "--name", "x"]);
		expect(created.code).toBe(0);
		const foo = JSON.parse(created.stdout) as { id: string; name: string };
		expect(foo.name).toBe("x");

		const listed = await cli(["foo", "list"]);
		expect(listed.code).toBe(0);
		expect(
			(JSON.parse(listed.stdout) as { items: { id: string }[] }).items,
		).toContainEqual(expect.objectContaining({ id: foo.id, name: "x" }));
	});
});

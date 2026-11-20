// Reads and runs no file of the app, only its imports and temporary git checkouts.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	devInstanceFile,
	devInstanceLinkedIs,
	devInstanceNameCreate,
	devInstanceWrite,
} from "./dev-instance.ts";
import { hostPortsCreate } from "./template-render.ts";

const git = (directory: string, ...args: string[]) =>
	execFileSync("git", args, { cwd: directory, stdio: "ignore" });

// A Project's main checkout with one commit, and a linked worktree of it.
const checkoutsCreate = (root: string) => {
	const main = join(root, "invoicing");
	const linked = join(root, "Fix_Login.Bug");
	mkdirSync(main);
	writeFileSync(join(main, "package.json"), '{"name":"invoicing"}\n');
	writeFileSync(
		join(main, ".env.schema"),
		"PORT=3000\nHEALTH_PORT=9000\nPOSTGRES_HOST_PORT=5432\nCOMPOSE_PROJECT_NAME=invoicing\n",
	);
	git(main, "init", "-q");
	git(main, "add", ".");
	git(
		main,
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"one",
	);
	git(main, "worktree", "add", "-q", linked);
	return { linked, main };
};

describe("devInstanceNameCreate", () => {
	it("joins the Project and worktree folder in a-z, 0-9 and hyphens", () => {
		expect(devInstanceNameCreate("invoicing", "Fix_Login.Bug")).toBe(
			"invoicing-fix-login-bug",
		);
		expect(devInstanceNameCreate("invoicing", "--Ünïcode 42--")).toBe(
			"invoicing-n-code-42",
		);
	});
});

describe("devInstanceLinkedIs", () => {
	it("tells a linked worktree from the main checkout", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { linked, main } = checkoutsCreate(root.path);

		expect(devInstanceLinkedIs(main)).toBe(false);
		expect(devInstanceLinkedIs(linked)).toBe(true);
	});
});

describe("devInstanceWrite", () => {
	it("writes nothing in the main checkout", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { main } = checkoutsCreate(root.path);

		expect(devInstanceWrite(main)).toBeUndefined();
		expect(existsSync(join(main, devInstanceFile))).toBe(false);
	});

	it("writes a linked worktree's compose project and the ports its schema declares", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { linked } = checkoutsCreate(root.path);
		const ports = hostPortsCreate("invoicing-fix-login-bug");

		expect(devInstanceWrite(linked)).toBe("invoicing-fix-login-bug");
		expect(readFileSync(join(linked, devInstanceFile), "utf8")).toBe(
			`# This worktree's dev instance (scripts/dev-instance.ts). The Worker serves on HEALTH_PORT + 1.\nCOMPOSE_PROJECT_NAME=invoicing-fix-login-bug\nPOSTGRES_HOST_PORT=${ports.POSTGRES_HOST_PORT}\nPORT=${ports.PORT}\nHEALTH_PORT=${ports.HEALTH_PORT}\n`,
		);
	});

	it("adds to a file without a compose project and never changes one that has it", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { linked } = checkoutsCreate(root.path);
		const path = join(linked, devInstanceFile);
		writeFileSync(path, "LOG_LEVEL=debug");

		devInstanceWrite(linked);
		const written = readFileSync(path, "utf8");
		expect(written).toMatch(
			/^LOG_LEVEL=debug\n# This worktree's dev instance.*\nCOMPOSE_PROJECT_NAME=invoicing-fix-login-bug\n/,
		);

		writeFileSync(path, `${written}PORT=1234\n`);
		expect(devInstanceWrite(linked)).toBe("invoicing-fix-login-bug");
		expect(readFileSync(path, "utf8")).toBe(`${written}PORT=1234\n`);

		writeFileSync(path, "COMPOSE_PROJECT_NAME=mine\n");
		expect(devInstanceWrite(linked)).toBe("mine");
		expect(readFileSync(path, "utf8")).toBe("COMPOSE_PROJECT_NAME=mine\n");
	});
});

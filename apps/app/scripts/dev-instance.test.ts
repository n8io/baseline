// Reads and runs no file of the app, only its imports and temporary git checkouts.
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
import { gitRun } from "./process-run.ts";
import { hostPortsCreate } from "./template-render.ts";

// A Project's original checkout with one commit, and a linked worktree of it.
const checkoutsCreate = (root: string) => {
	const original = join(root, "invoicing");
	const linked = join(root, "Fix_Login.Bug");
	mkdirSync(original);
	writeFileSync(join(original, "package.json"), '{"name":"invoicing"}\n');
	writeFileSync(
		join(original, ".env.schema"),
		"PORT=3000\nHEALTH_PORT=9000\nPOSTGRES_HOST_PORT=5432\nCOMPOSE_PROJECT_NAME=invoicing\n",
	);
	gitRun(original, ["init", "-q"]);
	gitRun(original, ["add", "."]);
	gitRun(original, [
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"one",
	]);
	gitRun(original, ["worktree", "add", "-q", linked]);
	return { linked, original };
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
	it("tells a linked worktree from the original checkout", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { linked, original } = checkoutsCreate(root.path);

		expect(devInstanceLinkedIs(original)).toBe(false);
		expect(devInstanceLinkedIs(linked)).toBe(true);
	});

	it("takes a folder outside git for the original checkout", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));

		expect(devInstanceLinkedIs(root.path)).toBe(false);
	});
});

describe("devInstanceWrite", () => {
	it("writes nothing in the original checkout", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { original } = checkoutsCreate(root.path);

		expect(devInstanceWrite(original)).toBeUndefined();
		expect(existsSync(join(original, devInstanceFile))).toBe(false);
	});

	it("writes a linked worktree's compose project and the ports its schema declares", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { linked } = checkoutsCreate(root.path);
		const ports = hostPortsCreate("invoicing-fix-login-bug");

		expect(devInstanceWrite(linked)).toBe("invoicing-fix-login-bug");
		expect(readFileSync(join(linked, devInstanceFile), "utf8")).toBe(
			`# This worktree's dev instance (scripts/dev-instance.ts). The Worker serves on HEALTH_PORT + 1.\nCOMPOSE_PROJECT_NAME=invoicing-fix-login-bug\nPOSTGRES_HOST_PORT=${ports["POSTGRES_HOST_PORT"]}\nPORT=${ports["PORT"]}\nHEALTH_PORT=${ports["HEALTH_PORT"]}\n`,
		);
	});

	it("refuses a worktree folder that would name the original checkout's instance", () => {
		using root = mkdtempDisposableSync(join(tmpdir(), "dev-instance-"));
		const { original } = checkoutsCreate(root.path);
		const linked = join(root.path, "___");
		gitRun(original, ["worktree", "add", "-q", linked]);

		expect(() => devInstanceWrite(linked)).toThrow(/letter or digit/);
		expect(existsSync(join(linked, devInstanceFile))).toBe(false);
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

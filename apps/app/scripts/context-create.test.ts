import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempDisposableSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	contextFilesCreate,
	contextNextStepsText,
	contextRefusal,
} from "./context-create.ts";
import {
	filesRead,
	filesWrite,
	templateFilesRender,
} from "./template-render.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(
	[
		"../**",
		"../**/.*",
		"../.*/**",
		"!../.git/**",
		"!../.react-router/**",
		"!**/*.md",
	],
	{ query: "?raw" },
);
import.meta.glob(["../CONTEXT.md"], { query: "?raw" });

const appRoot = new URL("../", import.meta.url);
const contextsUrl = new URL("src/contexts/", appRoot);
const template =
	existsSync(contextsUrl) &&
	readdirSync(contextsUrl)
		.filter((name) => !name.startsWith("."))
		.join() === "foo";

describe("contextRefusal", () => {
	it("refuses a context that exists or that the glossary lacks", () => {
		using folder = mkdtempDisposableSync(join(tmpdir(), "context-create-"));
		const app = folder.path;
		writeFileSync(join(app, "CONTEXT.md"), "**Billing**:\nA context.\n");

		expect(
			contextRefusal({ appDirectory: app, context: "billing" }),
		).toBeUndefined();
		expect(contextRefusal({ appDirectory: app, context: "vendor" })).toContain(
			"CONTEXT.md has no **Vendor**: entry",
		);
		expect(contextRefusal({ appDirectory: app, context: "foo-two" })).toContain(
			"contains foo",
		);
	});
});

describe("contextNextStepsText", () => {
	it("points at aggregate-create and each reader to fill", () => {
		const text = contextNextStepsText({
			context: "billing",
			reads: ["customer"],
		});

		expect(text).toContain("pnpm aggregate-create billing <aggregate>");
		expect(text).toContain("src/bridges/billing-customer-reader.ts");
	});
});

describe("the context-create command", () => {
	const script = new URL("./context-create.ts", import.meta.url).pathname;
	const command = (...args: string[]) =>
		spawnSync(process.execPath, [script, ...args], {
			cwd: appRoot,
			encoding: "utf8",
		});

	it("prints its usage for --help and exits 0", () => {
		const run = command("--help");
		expect(run.status).toBe(0);
		expect(run.stdout).toContain("Usage: pnpm context-create <context>");
	});

	it("prints its usage and exits 1 on an unknown flag or no name, with no stack trace", () => {
		for (const args of [["billing", "--bare"], []]) {
			const run = command(...args);
			expect(run.status).toBe(1);
			expect(run.stderr).toContain("Usage:");
			expect(run.stderr).not.toMatch(/\n\s+at /);
		}
	});
});

describe.runIf(template)("context-create on the template", () => {
	const files = (() => {
		if (!template) return [];
		using folder = mkdtempDisposableSync(join(tmpdir(), "context-create-"));
		const templateFull = filesRead(appRoot.pathname);
		filesWrite(
			folder.path,
			templateFilesRender(templateFull, { description: "d", name: "n" }),
		);
		return contextFilesCreate({
			appDirectory: folder.path,
			context: "billing",
			templateFull,
		});
	})();
	const file = (path: string) => files.find((f) => f.path === path)?.text ?? "";

	it("writes the context's shell with a CONTEXT.md stub and no Aggregate", () => {
		const paths = files.map((f) => f.path);

		expect(paths).toContain("src/contexts/billing/CONTEXT.md");
		expect(paths).toContain("src/contexts/billing/application/ports.ts");
		expect(paths).toContain(
			"src/contexts/billing/adapters/outbound/billing-transaction.memory.ts",
		);
		expect(
			paths.filter((p) => p.startsWith("src/contexts/billing/domain/")),
		).toEqual([
			"src/contexts/billing/domain/errors.ts",
			"src/contexts/billing/domain/repositories.ts",
		]);
		expect(
			files.filter((f) => /\b[Ff]oo|(?<![A-Za-z])[Bb]ar(?![a-z])/.test(f.text)),
		).toEqual([]);
		expect(paths.filter((p) => p.startsWith("src/ui/"))).toEqual([]);
	});

	it("keeps the context's ports and wiring markers for aggregate-create", () => {
		expect(file("src/contexts/billing/application/ports.ts")).toContain(
			"billingClock: Clock;",
		);
		expect(file("src/contexts/billing/application/ports.ts")).toContain(
			"// wiring: ports",
		);
		expect(file("src/contexts/billing/application/ports.ts")).not.toContain(
			"Repository",
		);
		expect(file("src/use-cases.ts")).toContain(
			"billingUseCasesCreate(billingPortsCreate(connections))",
		);
	});
});

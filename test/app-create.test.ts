import {
	type DisposableTempDir,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	answersWrite,
	contextLanguageWrite,
	envFilesWrite,
	glossaryTerm,
	requiredJobs,
	rulesetBodyCreate,
	securityUpdatesCalls,
} from "../scripts/app-create.ts";

const projectCreate = (): DisposableTempDir => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "app-create-test-"));
	const directory = folder.path;
	writeFileSync(
		join(directory, ".env.development"),
		"APP_ENV=development\nAUTHN_SECRET=template-secret\nPORT=3000\n",
	);
	writeFileSync(
		join(directory, ".env.production"),
		"# References only.\nDATABASE_URL=op(op://app-production/database/url)\nAUTHN_SECRET=op(op://app-production/authn/secret)\n",
	);
	writeFileSync(
		join(directory, "CONTEXT.md"),
		"# Invoices.\n\n## Architecture\n\n**Domain**:\nOne entity.\n\n## Language\n",
	);
	return folder;
};
const read = (directory: string, path: string) =>
	readFileSync(join(directory, path), "utf8");

describe("app-create", () => {
	it("names the glossary term domain-create looks for", () => {
		expect(glossaryTerm("invoice-line")).toBe("Invoice line");
		expect(glossaryTerm("customer")).toBe("Customer");
	});

	it("adds each term under ## Language", () => {
		expect(
			contextLanguageWrite("# Invoices.\n\n## Language\n\n", [
				{ definition: "A charge.", term: "Invoice line" },
				{ definition: "A payer.", term: "Customer" },
			]),
		).toBe(
			"# Invoices.\n\n## Language\n\n**Invoice line**:\nA charge.\n\n**Customer**:\nA payer.\n",
		);
	});

	it("writes a fresh AUTHN_SECRET and the project's own production vault", () => {
		using folder = projectCreate();
		const directory = folder.path;
		envFilesWrite(directory, "invoicing");
		const secret = /^AUTHN_SECRET=(.*)$/m.exec(
			read(directory, ".env.development"),
		)?.[1];

		expect(secret).toMatch(/^[\w-]{43}$/);
		expect(read(directory, ".env.development")).toContain("PORT=3000\n");
		expect(read(directory, ".env.production")).toBe(
			"# References only.\nDATABASE_URL=op(op://invoicing-production/database/url)\nAUTHN_SECRET=op(op://invoicing-production/authn/secret)\n",
		);
		using second = projectCreate();
		envFilesWrite(second.path, "invoicing");
		expect(read(second.path, ".env.development")).not.toContain(
			`AUTHN_SECRET=${secret}`,
		);
	});

	it("saves the answers template-upgrade reads back in .template.json", () => {
		using folder = projectCreate();
		const directory = folder.path;
		answersWrite({
			directory,
			answers: {
				description: "Invoices.",
				name: "invoicing",
				release: "1.0.1",
			},
			terms: [{ definition: "A charge.", term: "Invoice line" }],
		});

		expect(JSON.parse(read(directory, ".template.json"))).toEqual({
			description: "Invoices.",
			release: "1.0.1",
		});
		expect(read(directory, "CONTEXT.md")).toContain(
			"## Language\n\n**Invoice line**:\nA charge.\n",
		);
		expect(read(directory, ".env.production")).toContain(
			"op://invoicing-production/",
		);
	});

	it("requires every app-ci.yml job but glossary-check, as ci / <job>", () => {
		const workflow = readFileSync(
			join(import.meta.dirname, "../.github/workflows/app-ci.yml"),
			"utf8",
		);
		const jobs = [...workflow.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]);

		expect([...requiredJobs, "glossary-check"].sort()).toEqual(jobs.sort());
		expect(rulesetBodyCreate()).toMatchObject({
			conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
			enforcement: "active",
			rules: [
				{
					parameters: {
						required_status_checks: requiredJobs.map((job) => ({
							context: `ci / ${job}`,
						})),
					},
					type: "required_status_checks",
				},
			],
			target: "branch",
		});
	});

	it("turns on Dependabot alerts before Dependabot security updates", () => {
		expect(securityUpdatesCalls("n8io/x")).toEqual([
			["api", "--method", "PUT", "repos/n8io/x/vulnerability-alerts"],
			["api", "--method", "PUT", "repos/n8io/x/automated-security-fixes"],
		]);
	});
});

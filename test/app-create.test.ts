import { once } from "node:events";
import {
	type DisposableTempDir,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	answersWrite,
	appCreateArgsRead,
	baselinePackagesPinned,
	contextLanguageWrite,
	envFilesWrite,
	glossaryTerm,
	npmVersionsWait,
	releaseWarning,
	repositoryFromRemote,
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

// A registry on localhost that serves a version only after `missesBefore` requests for it.
const registryServe = async (versions: Record<string, number>) => {
	const asked: string[] = [];
	const server = createServer((request, response) => {
		const path = request.url ?? "";
		asked.push(path);
		const misses = versions[path];
		const served =
			misses !== undefined && asked.filter((p) => p === path).length > misses;
		response.writeHead(served ? 200 : 404).end("{}");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address() as AddressInfo;
	return {
		asked,
		registry: `http://127.0.0.1:${port}`,
		[Symbol.asyncDispose]: async () => {
			server.close();
			await once(server, "close");
		},
	};
};

describe("app-create", () => {
	it("names the glossary term domain-create looks for", () => {
		expect(glossaryTerm("invoice-line")).toBe("Invoice line");
		expect(glossaryTerm("customer")).toBe("Customer");
	});

	it("reads the flags: GitHub by default, --no-github renders only, --github-only does GitHub only", () => {
		expect(
			appCreateArgsRead(["--name", "golf", "--description", "Golf."]),
		).toEqual({
			description: "Golf.",
			mode: "all",
			name: "golf",
			owner: null,
		});
		expect(appCreateArgsRead(["--no-github"]).mode).toBe("render");
		expect(
			appCreateArgsRead(["--github-only", "--owner", "n8io"]),
		).toMatchObject({
			mode: "github",
			owner: "n8io",
		});
		expect(() => appCreateArgsRead(["--github-only", "--no-github"])).toThrow(
			"cannot go together",
		);
		expect(() =>
			appCreateArgsRead(["--github-only", "--name", "golf"]),
		).toThrow("reads the name and description from the render");
		// The first Domain is the first pull request's job now.
		expect(() => appCreateArgsRead(["--domain", "golfer"])).toThrow("--domain");
	});

	it("warns when main holds changesets the newest release does not", () => {
		expect(
			releaseWarning({
				changesets: 3,
				checkoutRelease: "7.1.0",
				release: "7.1.0",
			}),
		).toBe("main holds 3 unreleased changesets; this Project gets app@7.1.0.");
		expect(
			releaseWarning({
				changesets: 1,
				checkoutRelease: "7.1.0",
				release: "7.1.0",
			}),
		).toBe("main holds 1 unreleased changeset; this Project gets app@7.1.0.");
		expect(
			releaseWarning({
				changesets: 0,
				checkoutRelease: "7.1.0",
				release: "7.1.0",
			}),
		).toBeNull();
		expect(
			releaseWarning({
				changesets: 0,
				checkoutRelease: "7.0.0",
				release: "7.1.0",
			}),
		).toBe(
			"This baseline checkout is app@7.0.0 and the newest release is app@7.1.0; this Project gets app@7.1.0.",
		);
	});

	it("waits on the @n8io/baseline-* versions the release pins", () => {
		expect(
			baselinePackagesPinned(
				JSON.stringify({
					dependencies: {
						"@n8io/baseline-http": "^2.1.0",
						"@n8io/baseline-id": "~1.0.0",
						react: "^19.0.0",
					},
				}),
			),
		).toEqual([
			{ name: "@n8io/baseline-http", version: "2.1.0" },
			{ name: "@n8io/baseline-id", version: "1.0.0" },
		]);
	});

	it("polls npm until it serves every pinned version, with one status line", async () => {
		await using fake = await registryServe({
			"/@n8io/baseline-http/2.1.0": 2,
			"/@n8io/baseline-id/1.0.0": 0,
		});
		const lines: string[] = [];
		await npmVersionsWait({
			intervalMs: 10,
			log: (line) => lines.push(line),
			packages: [
				{ name: "@n8io/baseline-http", version: "2.1.0" },
				{ name: "@n8io/baseline-id", version: "1.0.0" },
			],
			registry: fake.registry,
			timeoutMs: 60_000,
		});

		expect(lines).toEqual([
			"Waiting for npm to serve @n8io/baseline-http@2.1.0: a fresh release takes a few minutes. Checking every 0.01 s for up to 1 min.",
		]);
		// A served version is not asked again.
		expect(fake.asked.filter((p) => p.includes("baseline-id"))).toHaveLength(1);
		expect(fake.asked.filter((p) => p.includes("baseline-http"))).toHaveLength(
			3,
		);
	});

	it("stops waiting on npm after the timeout and names what is missing", async () => {
		await using fake = await registryServe({});
		await expect(
			npmVersionsWait({
				intervalMs: 10,
				log: () => {},
				packages: [{ name: "@n8io/baseline-http", version: "9.0.0" }],
				registry: fake.registry,
				timeoutMs: 50,
			}),
		).rejects.toThrow("npm still does not serve @n8io/baseline-http@9.0.0");
	});

	it("reads owner/name from the origin --github-only runs against", () => {
		expect(repositoryFromRemote("https://github.com/acme/golf.git\n")).toBe(
			"acme/golf",
		);
		expect(repositoryFromRemote("git@github.com:acme/golf.git")).toBe(
			"acme/golf",
		);
		expect(repositoryFromRemote("https://github.com/acme/golf")).toBe(
			"acme/golf",
		);
		expect(repositoryFromRemote("/tmp/elsewhere")).toBeNull();
	});

	it("leaves ## Language empty when there are no terms yet", () => {
		const text = "# Invoices.\n\n## Language\n";
		expect(contextLanguageWrite(text, [])).toBe(text);
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

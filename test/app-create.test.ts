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
	ciDispatch,
	contextLanguageWrite,
	envFilesWrite,
	glossaryTerm,
	mergeSettingsCall,
	npmVersionsWait,
	releaseWarning,
	repositoryFromRemote,
	requiredJobs,
	rulesetBodyCreate,
	rulesetChangesFind,
	rulesetReconcile,
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

	describe("ciDispatch", () => {
		const ghScript = (answers: (string | Error)[]) => {
			const calls: string[][] = [];
			const gh = async (args: string[]) => {
				calls.push(args);
				const answer = answers.shift() ?? "";
				if (answer instanceof Error) throw answer;
				return answer;
			};
			return { calls, gh };
		};
		const url = "https://github.com/acme/x/actions/runs/1";

		it("prints the run's URL when it shows up on a later poll", async () => {
			const { calls, gh } = ghScript(["", "", "", url]);

			expect(
				await ciDispatch({ gh, intervalMs: 1, repository: "acme/x" }),
			).toBe(`CI is running on main: ${url}`);
			expect(calls.map((c) => c[1])).toEqual(["run", "list", "list", "list"]);
		});

		it("says the run was started, not failed, when it never shows up", async () => {
			const { gh } = ghScript(["", ...Array<string>(3).fill("")]);

			expect(
				await ciDispatch({
					attempts: 3,
					gh,
					intervalMs: 1,
					repository: "acme/x",
				}),
			).toBe(
				"CI was started on main; its run has not shown up in the list yet, find it at https://github.com/acme/x/actions/workflows/ci.yml",
			);
		});

		it("says CI could not start when the dispatch fails", async () => {
			const { calls, gh } = ghScript([new Error("HTTP 404")]);

			expect(
				await ciDispatch({
					attempts: 1,
					gh,
					intervalMs: 1,
					repository: "acme/x",
				}),
			).toBe(
				"Could not start CI on main; run it from https://github.com/acme/x/actions/workflows/ci.yml",
			);
			expect(calls).toHaveLength(1);
		});

		it("retries a dispatch GitHub has not indexed yet, but not a missing workflow_dispatch", async () => {
			const early = ghScript([new Error("HTTP 404"), "", url]);
			expect(
				await ciDispatch({
					gh: early.gh,
					intervalMs: 1,
					repository: "acme/x",
				}),
			).toBe(`CI is running on main: ${url}`);

			const never = ghScript([new Error("no workflow_dispatch trigger")]);
			expect(
				await ciDispatch({
					gh: never.gh,
					intervalMs: 1,
					repository: "acme/x",
				}),
			).toContain("Could not start CI");
			expect(never.calls).toHaveLength(1);
		});
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

	it("requires every app-ci.yml job, as ci / <job>", () => {
		const workflow = readFileSync(
			join(import.meta.dirname, "../.github/workflows/app-ci.yml"),
			"utf8",
		);
		const jobs = [...workflow.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]);

		expect([...requiredJobs].sort()).toEqual(jobs.sort());
	});

	it("protects main like baseline's own: no deletion, no force push, squash only, the checks, no bypass", () => {
		const body = rulesetBodyCreate();
		const rule = (type: string) => body.rules.find((r) => r.type === type);

		expect(body).toMatchObject({
			bypass_actors: [],
			conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
			enforcement: "active",
			name: "ci",
			target: "branch",
		});
		expect(body.rules.map((r) => r.type).sort()).toEqual([
			"deletion",
			"non_fast_forward",
			"pull_request",
			"required_status_checks",
		]);
		expect(rule("pull_request")?.parameters).toMatchObject({
			allowed_merge_methods: ["squash"],
			required_approving_review_count: 0,
		});
		expect(rule("required_status_checks")?.parameters).toEqual({
			do_not_enforce_on_create: false,
			required_status_checks: requiredJobs.map((job) => ({
				context: `ci / ${job}`,
			})),
			strict_required_status_checks_policy: false,
		});
	});

	it("sets the repository to squash-only merging and deletes merged branches", () => {
		expect(mergeSettingsCall("n8io/x")).toEqual([
			"api",
			"--method",
			"PATCH",
			"repos/n8io/x",
			"-F",
			"allow_squash_merge=true",
			"-F",
			"allow_merge_commit=false",
			"-F",
			"allow_rebase_merge=false",
			"-F",
			"delete_branch_on_merge=true",
		]);
	});

	describe("ruleset reconcile", () => {
		// What GitHub answers: ids and defaults added, rules and checks in another order.
		const stored = () => {
			const { rules, ...rest } = rulesetBodyCreate();
			return {
				...rest,
				id: 7,
				rules: [...rules].reverse().map((r) =>
					r.type === "pull_request"
						? {
								...r,
								parameters: {
									required_approving_review_count: 0,
									require_extra_approval_for_unattributed_changes: true,
									required_reviewers: [],
									...r.parameters,
								},
							}
						: r.type === "required_status_checks"
							? {
									...r,
									parameters: {
										...r.parameters,
										required_status_checks: [
											...((r.parameters?.required_status_checks ??
												[]) as unknown[]),
										].reverse(),
									},
								}
							: r,
				),
				source: "n8io/x",
				source_type: "Repository",
			};
		};
		const ghFake = (answers: { list: unknown[]; ruleset?: unknown }) => {
			const calls: { args: string[]; input?: string | undefined }[] = [];
			const gh = (args: string[], input?: string) => {
				calls.push({ args, input });
				if (args.includes("--method")) return "{}";
				return JSON.stringify(
					args.at(-1)?.includes("/rulesets?") ? answers.list : answers.ruleset,
				);
			};
			return { calls, gh };
		};

		it("creates the ruleset when there is none", () => {
			const { calls, gh } = ghFake({ list: [{ id: 1, name: "other" }] });

			expect(rulesetReconcile({ gh, repository: "n8io/x" })).toBe(
				"Created the ci ruleset on n8io/x",
			);
			expect(calls.at(-1)).toEqual({
				args: [
					"api",
					"--method",
					"POST",
					"repos/n8io/x/rulesets",
					"--input",
					"-",
				],
				input: JSON.stringify(rulesetBodyCreate()),
			});
		});

		it("updates a ruleset that differs, and says what changed", () => {
			const old = {
				...stored(),
				bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
				rules: [
					{
						parameters: {
							required_status_checks: [{ context: "ci / check" }],
							strict_required_status_checks_policy: false,
						},
						type: "required_status_checks",
					},
				],
			};
			const { calls, gh } = ghFake({
				list: [{ id: 7, name: "ci" }],
				ruleset: old,
			});

			expect(rulesetReconcile({ gh, repository: "n8io/x" })).toBe(
				"Updated the ci ruleset on n8io/x: changed bypass_actors, changed rule required_status_checks (added ci / image, ci / integration, ci / pieces, ci / sast, ci / unit), added rule deletion, added rule non_fast_forward, added rule pull_request",
			);
			expect(calls.at(-1)).toEqual({
				args: [
					"api",
					"--method",
					"PUT",
					"repos/n8io/x/rulesets/7",
					"--input",
					"-",
				],
				input: JSON.stringify(rulesetBodyCreate()),
			});
		});

		it("makes no write when the ruleset already matches", () => {
			const { calls, gh } = ghFake({
				list: [{ id: 7, name: "ci" }],
				ruleset: stored(),
			});

			expect(rulesetReconcile({ gh, repository: "n8io/x" })).toBe(
				"n8io/x already has the ci ruleset as wanted",
			);
			expect(calls.map((c) => c.args.join(" "))).toEqual([
				"api repos/n8io/x/rulesets?includes_parents=false",
				"api repos/n8io/x/rulesets/7",
			]);
		});

		// app-ci.yml@v9 folded migrations and oasdiff into check. A v8 Project moves its ruleset
		// before the upgrade: that only drops checks, so v8's workflow still meets every one.
		it("only removes checks from a v8 ruleset", () => {
			const current = stored();
			const checks = current.rules.find(
				(r) => r.type === "required_status_checks",
			);
			if (checks?.parameters)
				checks.parameters.required_status_checks = [
					"check",
					"unit",
					"integration",
					"migrations",
					"oasdiff",
					"pieces",
					"image",
					"sast",
				].map((job) => ({ context: `ci / ${job}` }));

			expect(
				rulesetChangesFind({ current, wanted: rulesetBodyCreate() }),
			).toEqual([
				"changed rule required_status_checks (removed ci / migrations, ci / oasdiff)",
			]);
		});

		it("reports a changed merge method", () => {
			const current = stored();
			const pull = current.rules.find((r) => r.type === "pull_request");
			if (pull?.parameters)
				pull.parameters.allowed_merge_methods = ["merge", "squash"];

			expect(
				rulesetChangesFind({ current, wanted: rulesetBodyCreate() }),
			).toEqual(["changed rule pull_request"]);
		});
	});

	it("turns on Dependabot alerts before Dependabot security updates", () => {
		expect(securityUpdatesCalls("n8io/x")).toEqual([
			["api", "--method", "PUT", "repos/n8io/x/vulnerability-alerts"],
			["api", "--method", "PUT", "repos/n8io/x/automated-security-fixes"],
		]);
	});
});

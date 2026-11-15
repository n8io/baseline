// Writes .github/semgrep/rules.txt: the pinned snapshot of the Semgrep rule packs both `sast`
// jobs scan with. It reads which rules each pack holds from semgrep.dev today and pins the
// files of those rules at one commit of github.com/semgrep/semgrep-rules, so a scan never asks
// semgrep.dev for rules. The Semgrep Rules License forbids redistributing the rules, so the
// snapshot is a list of paths and each scan fetches them itself (.github/semgrep/rules.sh).
// Moving the pin: apps/app/docs/agents/dependency-updates.md. test/semgrep-pin.test.ts checks it.
// Usage: node scripts/semgrep-rules-write.ts <semgrep-rules commit>
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const semgrepPacks = ["typescript", "nodejs", "react", "secrets"];

// The registry answers in YAML or JSON (p/nodejs and p/secrets come as JSON). Each rule id is its file path with dots, then the
// rule's own id: `javascript.jose.security.jwt-hardcode.jwt-hardcode`.
export const semgrepRuleIdsRead = (text: string): string[] =>
	text.trimStart().startsWith("{")
		? (JSON.parse(text) as { rules: { id: string }[] }).rules.map(
				(rule) => rule.id,
			)
		: [...text.matchAll(/^- id: (\S+)$/gm)].map((match) => String(match[1]));

export const semgrepRulePathsRead = (input: {
	ids: string[];
	tree: string[];
}): string[] => {
	const files = new Set(input.tree);
	const paths = input.ids.map((id) => {
		const stem = id.split(".").slice(0, -1).join("/");
		const path = [`${stem}.yaml`, `${stem}.yml`].find((file) =>
			files.has(file),
		);
		if (!path) throw new Error(`no rule file in semgrep-rules for ${id}`);
		return path;
	});
	return [...new Set(paths)].sort();
};

// Blobless and one commit deep, so it reads the tree without downloading the rules.
const semgrepRulesTreeRead = (commit: string): string[] => {
	const dir = mkdtempSync(join(tmpdir(), "semgrep-rules-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	try {
		git("init", "-q");
		git("remote", "add", "origin", "https://github.com/semgrep/semgrep-rules");
		git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit);
		return git("ls-tree", "-r", "--name-only", "FETCH_HEAD").split("\n");
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
};

const textFetch = async (url: string): Promise<string> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response.text();
};

export const semgrepRulesWrite = async (commit: string): Promise<void> => {
	if (!/^[0-9a-f]{40}$/.test(commit)) {
		throw new Error("pass the full 40-character semgrep-rules commit");
	}
	const ids = (
		await Promise.all(
			semgrepPacks.map(async (pack) => {
				const packIds = semgrepRuleIdsRead(
					await textFetch(`https://semgrep.dev/c/p/${pack}`),
				);
				if (packIds.length === 0) throw new Error(`p/${pack} has no rules`);
				return packIds;
			}),
		)
	).flat();
	const paths = semgrepRulePathsRead({
		ids,
		tree: semgrepRulesTreeRead(commit),
	});
	const day = new Date().toISOString().slice(0, 10);
	const header = [
		`# Written by scripts/semgrep-rules-write.ts on ${day} from ${semgrepPacks.map((pack) => `p/${pack}`).join(" ")}.`,
		`commit ${commit}`,
		// rules.sh checks the files hold exactly these, so a file that gains a rule fails the bump.
		`rules ${new Set(ids).size}`,
	];
	writeFileSync(
		resolve(import.meta.dirname, "../.github/semgrep/rules.txt"),
		`${[...header, ...paths].join("\n")}\n`,
	);
};

if (import.meta.main) {
	await semgrepRulesWrite(String(process.argv[2]));
}

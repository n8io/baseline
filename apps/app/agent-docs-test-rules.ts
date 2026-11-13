import { readdirSync, readFileSync, statSync } from "node:fs";

type AgentDoc = { path: string; text: string };

// A file AGENTS.md names as `@<path>.md` outside code. Claude Code loads it with AGENTS.md. In a
// sentence the path takes the punctuation after it (`@CONTEXT.md.` names no file), so the one
// form allowed is the import alone on its line.
const agentDocsImports = (agentsText: string): string[] => {
	const prose = agentsText
		.replace(/^```[\s\S]*?^```/gm, "")
		.replace(/`[^`\n]*`/g, "");
	return [
		...new Set(
			[...prose.matchAll(/(?<![\w/])@([\w./-]*\w\.md)\b/g)].map(
				([, path = ""]) => path,
			),
		),
	];
};

// AGENTS.md loads on every task, so it stays small and links the rest. Each file it imports, or
// that it or a doc in docs/agents/ links to, must exist, and each docs/agents/ file must be
// linked from AGENTS.md. `docs` holds AGENTS.md and every docs/agents/ file.
export const agentDocsViolations = ({
	agentsMaxBytes,
	docs,
	exists,
}: {
	agentsMaxBytes: number;
	docs: AgentDoc[];
	exists: (path: string) => boolean;
}): string[] => {
	const problems: string[] = [];
	const agents = docs.find((d) => d.path === "AGENTS.md");
	if (agents) {
		if (new TextEncoder().encode(agents.text).length > agentsMaxBytes)
			problems.push(
				`AGENTS.md: keep it to ${agentsMaxBytes} bytes; move task-specific rules to docs/agents/`,
			);
		const lines = agents.text.split("\n").map((line) => line.trim());
		for (const path of agentDocsImports(agents.text)) {
			if (!lines.includes(`@${path}`))
				problems.push(
					`AGENTS.md: put @${path} alone on its line, or it is not imported`,
				);
			if (!exists(new URL(path, "file:///").pathname.slice(1)))
				problems.push(`AGENTS.md: imports ${path}, which does not exist`);
		}
	}
	for (const { path, text } of docs) {
		const dir = path.includes("/")
			? path.slice(0, path.lastIndexOf("/") + 1)
			: "";
		for (const [, target = ""] of text.matchAll(
			/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g,
		)) {
			if (/^[a-z]+:/.test(target)) continue;
			const resolved = new URL(target, `file:///${dir}`).pathname.slice(1);
			if (!exists(resolved))
				problems.push(`${path}: links ${target}, which does not exist`);
		}
	}
	for (const { path } of docs.filter((d) => d.path.startsWith("docs/agents/")))
		if (!agents?.text.includes(`](${path})`))
			problems.push(`AGENTS.md: link ${path} under ## Read when`);
	return problems;
};

// Checks the AGENTS.md under `root` and every file in its docs/agents/ folder.
export const agentDocsViolationsRead = (
	root: URL,
	agentsMaxBytes: number,
): string[] => {
	const isFile = (path: string) =>
		statSync(new URL(path, root), { throwIfNoEntry: false })?.isFile() ?? false;
	const docsDir = new URL("docs/agents/", root);
	const docPaths = statSync(docsDir, { throwIfNoEntry: false })
		? readdirSync(docsDir, { encoding: "utf8", recursive: true })
				.map((name) => `docs/agents/${name.replaceAll("\\", "/")}`)
				// Dotfiles (.DS_Store) are the OS's, not the project's.
				.filter((path) => !/(^|\/)\./.test(path) && isFile(path))
		: [];
	const docs = ["AGENTS.md", ...docPaths].map((path) => ({
		path,
		text: readFileSync(new URL(path, root), "utf8"),
	}));
	return agentDocsViolations({ docs, exists: isFile, agentsMaxBytes });
};

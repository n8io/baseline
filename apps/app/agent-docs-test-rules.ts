export type AgentDoc = { path: string; text: string };

export type AgentDocsBudget = {
	// AGENTS.md alone, in bytes.
	agentsMaxBytes: number;
	// AGENTS.md with every file it imports, in bytes: what an agent holds on every task.
	loadedMaxBytes: number;
};

// A file AGENTS.md names as `@<path>.md`. Claude Code loads it with AGENTS.md, but only when the
// import is alone on its line: `@CONTEXT.md.` in a sentence names a file that does not exist.
const agentDocsImportPattern = /(?<![\w`/])@([\w./-]*\w\.md)\b/g;

export const agentDocsImports = (agentsText: string): string[] =>
	[...agentsText.matchAll(agentDocsImportPattern)].map(([, path = ""]) => path);

const bytes = (text: string) => new TextEncoder().encode(text).length;

// AGENTS.md loads on every task, so it stays small and links the rest. Each file it imports, or
// that it or a doc in docs/agents/ links to, must exist, and each docs/agents/ file must be
// linked from AGENTS.md. `docs` holds AGENTS.md, its imports and every docs/agents/ file.
export const agentDocsViolations = (
	docs: AgentDoc[],
	exists: (path: string) => boolean,
	budget: AgentDocsBudget,
): string[] => {
	const problems: string[] = [];
	const agents = docs.find((d) => d.path === "AGENTS.md");
	if (agents) {
		const lines = agents.text.split("\n").map((line) => line.trim());
		let loaded = bytes(agents.text);
		for (const path of agentDocsImports(agents.text)) {
			if (!lines.includes(`@${path}`))
				problems.push(
					`AGENTS.md: put @${path} alone on its line, or it is not imported`,
				);
			const imported = docs.find((d) => d.path === path);
			if (imported) loaded += bytes(imported.text);
			else problems.push(`AGENTS.md: imports ${path}, which does not exist`);
		}
		if (bytes(agents.text) > budget.agentsMaxBytes)
			problems.push(
				`AGENTS.md: keep it under ${budget.agentsMaxBytes} bytes; move task-specific rules to docs/agents/`,
			);
		else if (loaded > budget.loadedMaxBytes)
			problems.push(
				`AGENTS.md: keep it and its imports under ${budget.loadedMaxBytes} bytes; every task loads them`,
			);
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

// Reads AGENTS.md, its imports and docs/agents/ under `root`, and checks them.
export const agentDocsViolationsRead = (
	root: URL,
	docPaths: string[],
	read: (url: URL) => string | undefined,
	budget: AgentDocsBudget,
): string[] => {
	const agentsText = read(new URL("AGENTS.md", root)) ?? "";
	const paths = ["AGENTS.md", ...agentDocsImports(agentsText), ...docPaths];
	const docs = [...new Set(paths)].flatMap((path) => {
		const text = read(new URL(path, root));
		return text === undefined ? [] : [{ path, text }];
	});
	return agentDocsViolations(
		docs,
		(path) => read(new URL(path, root)) !== undefined,
		budget,
	);
};

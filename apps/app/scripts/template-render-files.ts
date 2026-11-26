// Rendering one file without foo.
import { createHash } from "node:crypto";
import { fooBlocksFind, linesRemove } from "./template-render-blocks.ts";
import { lineIsFoo } from "./template-render-scan.ts";
import {
	type TemplateAnswers,
	type TemplateFile,
	templateRepository,
} from "./template-render-types.ts";

// Files and folders that are foo's alone, deleted whole.
const templateFooPaths = [
	/^src\/contexts\/foo\//,
	/^src\/ui\/routes\/(foo-[^/]+|home)(\.test)?\.tsx?$/,
	// Integration tests that drive foo are named foo-*.test.ts.
	/^test\/integration\/foo-[^/]+\.test\.ts$/,
	/^migrations\/[^/]*foo[^/]*\//,
];

// Never rendered: the scripts and their tests name foo on purpose, and the changelog is the Template's own.
// The lockfile names no foo, but an integrity hash can hold "Foo", and dropping that line breaks it.
const templateUntouchedPaths = [/^scripts\//, /^pnpm-lock\.yaml$/];
const templateSkippedPaths = [/^CHANGELOG\.md$/, /^template-renames\.json$/];

// Lines between a `wiring: contexts-start` and `contexts-end` marker pair are valid only while
// a context exists. The render empties each pair; context-create and model-create fill them.
const contextsStart = /^\s*(\/\/|#) wiring: contexts-start\s*$/;
const contextsEnd = /^\s*(\/\/|#) wiring: contexts-end\s*$/;

// Each pair's marker lines [start, end].
export const contextsPairsFind = (
	text: string,
	path: string,
): [number, number][] => {
	const pairs: [number, number][] = [];
	let start: number | undefined;
	for (const [k, line] of text.split("\n").entries()) {
		const misplaced = contextsStart.test(line)
			? start !== undefined
			: contextsEnd.test(line) && start === undefined;
		if (misplaced) {
			throw new Error(`${path}:${k + 1}: wiring markers must pair up`);
		}
		if (contextsStart.test(line)) start = k;
		if (contextsEnd.test(line) && start !== undefined) {
			pairs.push([start, k]);
			start = undefined;
		}
	}
	if (start !== undefined) {
		throw new Error(`${path}:${start + 1}: contexts-start has no contexts-end`);
	}
	return pairs;
};

export const contextsPairsEmpty = (text: string, path: string): string =>
	linesRemove(
		text,
		contextsPairsFind(text, path).map(([start, end]) => [start + 1, end - 1]),
	);

// CONTEXT.md keeps every Architecture term as written, foo in their examples too; its title
// becomes the Project's description. foo's own terms live in src/contexts/foo/, which never renders.
const contextRender = (text: string, answers: TemplateAnswers): string => {
	const lines = text.split("\n");
	lines[0] = `# ${answers.description}`;
	return lines.join("\n");
};

// README.md names the Project and the release it was made from: its `# app` title becomes the
// Project's name, its bold line the description, and its first `<sub>` line, which describes the
// Template, a link to the release's changelog. A README missing one of them throws, so the
// Template's README cannot drift from this.
export const readmeRender = ({
	answers,
	release,
	text,
}: {
	answers: TemplateAnswers;
	release: string;
	text: string;
}): string => {
	const lines = text.split("\n");
	const description = lines.findIndex((line) => /^\*\*.+\*\*$/.test(line));
	const made = lines.findIndex((line) => line.startsWith("<sub>"));
	if (lines[0] !== "# app" || description === -1 || made === -1) {
		throw new Error(
			"README.md: needs a `# app` title, a bold description line and a <sub> line",
		);
	}
	if (release === "") throw new Error("README.md: package.json has no version");
	const tag = `app@${release}`;
	lines[0] = `# ${answers.name}`;
	lines[description] = `**${answers.description.trim()}**`;
	lines[made] =
		`<sub>Made from [baseline](https://github.com/${templateRepository}) [${tag}](https://github.com/${templateRepository}/blob/${encodeURIComponent(tag)}/apps/app/CHANGELOG.md). \`pnpm template-upgrade\` takes a newer release.</sub>`;
	return lines.join("\n");
};

// A Project's own ports, from its name, so two Projects run side by side on one machine: seven in a
// row at a multiple of ten from 20000 to 29999, below the range the OS hands out to outgoing
// connections. compose.yaml publishes the four *_HOST_PORT ones (.env.schema); `pnpm dev` serves on
// PORT and HEALTH_PORT (.env.development) and runs the Worker on HEALTH_PORT + 1. A linked git
// worktree's dev instance gets its own from its instance name (scripts/dev-instance.ts). The
// Template keeps 5432, 6379, 3000, 9000 and 9001. Two names can land on the same block (one in a
// thousand): change the four *_HOST_PORT values in .env.schema and PORT and HEALTH_PORT in
// .env.development then (in .env.development.local for a worktree). The block's seventh port,
// HEALTH_PORT + 1, is the Worker's.
export const hostPortsCreate = (name: string): Record<string, number> => {
	const block =
		createHash("sha256").update(name).digest().readUInt32BE(0) % 1000;
	const first = 20_000 + block * 10;
	return {
		POSTGRES_HOST_PORT: first,
		REDIS_HOST_PORT: first + 1,
		SERVER_HOST_PORT: first + 2,
		HEALTH_HOST_PORT: first + 3,
		PORT: first + 4,
		HEALTH_PORT: first + 5,
	};
};

// The Template's own name ("app") as the compose project, in compose.yaml and .env.schema.
const composeProjectRender = (text: string, name: string): string =>
	text
		.replace(/^name: app$/m, `name: ${name}`)
		.replace(/^COMPOSE_PROJECT_NAME=app$/m, `COMPOSE_PROJECT_NAME=${name}`);

// Which of hostPortsCreate's ports each env file sets; .env.schema keeps the production PORT and
// HEALTH_PORT.
const hostPortItems: Record<string, string[]> = {
	".env.development": ["PORT", "HEALTH_PORT"],
	".env.schema": [
		"POSTGRES_HOST_PORT",
		"REDIS_HOST_PORT",
		"SERVER_HOST_PORT",
		"HEALTH_HOST_PORT",
	],
};

const hostPortsRender = (file: TemplateFile, name: string): string => {
	const ports = hostPortsCreate(name);
	return (hostPortItems[file.path] ?? []).reduce(
		(rendered, item) =>
			rendered.replace(
				new RegExp(`^${item}=\\d+$`, "m"),
				`${item}=${ports[item]}`,
			),
		file.text,
	);
};

// The development Environment is the Project's own `pnpm dev` (PORT), in clients/environments.json
// and in the SDK's copy of the document, which the sdk-generate script writes from it.
const developmentUrlRender = (text: string, name: string): string =>
	text.replaceAll(
		"http://localhost:3000",
		`http://localhost:${hostPortsCreate(name)["PORT"]}`,
	);

// The SDK's files (the sdk Piece). Its generated files are rendered as pnpm sdk-generate writes
// them for a Project with no bounded context: the document without foo's operations and schemas,
// and an sdk.ts that is only its header comment.
const sdkFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const { path, text } = file;
	if (path === "clients/sdk/package.json") {
		const manifest = JSON.parse(text) as Record<string, unknown>;
		manifest["name"] = `${answers.name}-sdk`;
		return { path, text: `${JSON.stringify(manifest, null, "\t")}\n` };
	}
	if (path === "clients/sdk/sdk.ts") {
		// orval writes the header and a blank line for a document with no operations.
		const header = /^\/\*\*[\s\S]*?\*\/\n/.exec(text)?.[0] ?? "";
		return { path, text: `${header}\n` };
	}
	if (path !== "clients/sdk/openapi.json") return undefined;
	const document = JSON.parse(text) as {
		components?: { schemas?: Record<string, unknown> };
		info: { title: string };
		paths: Record<string, unknown>;
	};
	const fooless = (record: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(record).filter(([key]) => !lineIsFoo(key)),
		);
	document.info.title = answers.name;
	document.paths = fooless(document.paths);
	// Bar's schemas go with foo's: Bar is foo's second Model, whose names do not say foo.
	if (document.components?.schemas !== undefined) {
		document.components.schemas = Object.fromEntries(
			Object.entries(fooless(document.components.schemas)).filter(
				([key]) => !/^Bar[A-Z]/.test(key),
			),
		);
	}
	// Compact, as pnpm sdk-generate saves it; templateFinish formats both alike.
	return {
		path,
		text: developmentUrlRender(JSON.stringify(document), answers.name),
	};
};

// The CLI's files (the cli Piece): its package, its command and the SDK it runs on take the
// Project's name.
const cliFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const { path } = file;
	if (!path.startsWith("clients/cli/")) return undefined;
	const text = file.text.replaceAll("app-sdk", `${answers.name}-sdk`);
	if (path !== "clients/cli/package.json") return { path, text };
	const manifest = JSON.parse(text) as Record<string, unknown>;
	manifest["name"] = `${answers.name}-cli`;
	manifest["bin"] = { [answers.name]: "./cli.ts" };
	return { path, text: `${JSON.stringify(manifest, null, "\t")}\n` };
};

export const templateFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const clientFile =
		sdkFileRender(file, answers) ?? cliFileRender(file, answers);
	if (clientFile !== undefined) return clientFile;
	const { path, text } = file;
	if (templateSkippedPaths.some((p) => p.test(path))) return undefined;
	if (templateFooPaths.some((p) => p.test(path))) return undefined;
	if (templateUntouchedPaths.some((p) => p.test(path))) return file;
	if (path === "CONTEXT.md")
		return { path, text: contextRender(text, answers) };
	if (path === "clients/environments.json")
		return { path, text: developmentUrlRender(text, answers.name) };
	// A Project's biome.json is its root config, not one nested in the monorepo.
	if (path === "biome.json") {
		return { path, text: text.replace(/\n\t"root": false,/, "") };
	}
	if (path === "package.json") {
		const manifest = JSON.parse(text) as Record<string, unknown>;
		manifest["name"] = answers.name;
		// The version is the Project's own, never the Template's.
		delete manifest["version"];
		return {
			path,
			text: `${JSON.stringify(manifest, null, "\t")}\n`,
		};
	}
	const ported = Object.hasOwn(hostPortItems, path)
		? hostPortsRender(file, answers.name)
		: text;
	const rendered =
		path === "compose.yaml" || path === ".env.schema"
			? composeProjectRender(ported, answers.name)
			: ported;
	// A root with no foo line, such as the Worker, may still hold a pair to empty.
	if (!lineIsFoo(rendered) && contextsPairsFind(rendered, path).length === 0) {
		return { path, text: rendered };
	}
	const emptied = contextsPairsEmpty(rendered, path);
	return { path, text: linesRemove(emptied, fooBlocksFind(emptied, path)) };
};

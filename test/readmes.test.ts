import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	readmeSvgDirectory,
	readmeSvgsRender,
} from "../scripts/readme-svg-write.ts";

// The rules these check are in docs/agents/readmes.md.
const root = resolve(import.meta.dirname, "..");
const rawUrlPrefix = "https://raw.githubusercontent.com/n8io/baseline/main/";
const svgNamespace = "http://www.w3.org/2000/svg";

const committedSvgs = (): string[] =>
	readdirSync(join(root, readmeSvgDirectory))
		.filter((file) => file.endsWith(".svg"))
		.sort();

const svgViolations = (svg: string): string[] =>
	[
		/<title>[^<]+<\/title>/.test(svg) ? undefined : "has no <title>",
		/<script/i.test(svg) ? "has a <script>" : undefined,
		/@import|@font-face/i.test(svg) ? "loads an external font" : undefined,
		svg.replaceAll(svgNamespace, "").match(/(?:https?:)?\/\/[\w.-]+/i)
			? "links to another host"
			: undefined,
		svg.includes("@media (prefers-reduced-motion: reduce)")
			? undefined
			: "has no reduced-motion block",
	].filter((violation) => violation !== undefined);

// Image sources in Markdown (`![alt](src)`) and HTML (`<img src="src">`).
const imageSources = (markdown: string): string[] => [
	...[...markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)].map(
		(match) => match[1] ?? "",
	),
	...[...markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(
		(match) => match[1] ?? "",
	),
];

// A README that npm or a Project shows outside this repo needs absolute image URLs.
const absoluteReadmes = (): string[] =>
	[
		"apps/app/README.md",
		...readdirSync(join(root, "packages")).map(
			(name) => `packages/${name}/README.md`,
		),
	].filter((file) => existsSync(join(root, file)));

const absoluteImageViolations = (file: string): string[] =>
	imageSources(readFileSync(join(root, file), "utf8")).flatMap((source) => {
		if (!source.startsWith(rawUrlPrefix)) {
			return [`${file}: ${source} is not under ${rawUrlPrefix}`];
		}
		const path = source.slice(rawUrlPrefix.length).split(/[?#]/)[0] ?? "";
		return existsSync(join(root, path))
			? []
			: [`${file}: ${source} names ${path}, which is not committed`];
	});

// A Package README opts in to the Blueprint shape with a `## Guarantees` section. Then its
// sections run title, promise, install, Guarantees, Example, Reference, and it ends on Needs.
const blueprintSections = ["Guarantees", "Example", "Reference"];

const blueprintViolations = (name: string, markdown: string): string[] => {
	const lines = markdown.trimEnd().split("\n");
	const sections = lines
		.filter((line) => line.startsWith("## "))
		.map((line) => line.slice(3).trim());
	const top = markdown.split("\n## ")[0] ?? "";
	const beforeReference = markdown.split("\n## Reference")[0] ?? "";
	const longExamples = [
		...beforeReference.matchAll(/^```\w*\n([\s\S]*?)^```/gm),
	].filter((match) => (match[1] ?? "").trimEnd().split("\n").length > 15);
	return [
		lines[0] === `# @n8io/baseline-${name}`
			? undefined
			: `starts with "# @n8io/baseline-${name}"`,
		/^\*\*[^*]+\*\*/m.test(top) ? undefined : "opens with a bold promise",
		top.includes(`pnpm add @n8io/baseline-${name}`)
			? undefined
			: "shows the install line before the first section",
		JSON.stringify(sections) === JSON.stringify(blueprintSections)
			? undefined
			: `has the sections ${blueprintSections.join(", ")} in that order, not ${sections.join(", ")}`,
		longExamples.length === 0
			? undefined
			: "keeps each example above Reference to 15 lines or fewer",
		lines.at(-1)?.startsWith("**Needs**") ? undefined : "ends on **Needs**",
	]
		.filter((violation) => violation !== undefined)
		.map((violation) => `packages/${name}/README.md ${violation}`);
};

describe("README SVGs", () => {
	it("commits exactly what `pnpm readme-svg` writes", async () => {
		const rendered = await readmeSvgsRender();
		expect(rendered.size).toBeGreaterThan(0);
		expect(committedSvgs()).toEqual(
			[...rendered.keys()].map((name) => `${name}.svg`).sort(),
		);
		for (const [name, svg] of rendered) {
			expect(
				readFileSync(join(root, readmeSvgDirectory, `${name}.svg`), "utf8"),
				`docs/readme/${name}.svg is stale: run pnpm readme-svg`,
			).toBe(svg);
		}
	});

	it.each(committedSvgs())(
		"%s is self-contained, titled and honours reduced motion",
		(file) => {
			expect(
				svgViolations(
					readFileSync(join(root, readmeSvgDirectory, file), "utf8"),
				),
			).toEqual([]);
		},
	);

	it("catches each thing an SVG must not do", () => {
		const good = `<svg xmlns="${svgNamespace}"><title>t</title><style>@media (prefers-reduced-motion: reduce){}</style></svg>`;
		expect(svgViolations(good)).toEqual([]);
		expect(svgViolations(good.replace("<title>t</title>", ""))).toEqual([
			"has no <title>",
		]);
		expect(svgViolations(`${good}<script/>`)).toEqual(["has a <script>"]);
		expect(svgViolations(`${good}<style>@import url(a.css)</style>`)).toEqual([
			"loads an external font",
		]);
		expect(svgViolations(`${good}<image href="https://x.dev/a.png"/>`)).toEqual(
			["links to another host"],
		);
		expect(svgViolations(good.replace("prefers-reduced-motion", "x"))).toEqual([
			"has no reduced-motion block",
		]);
	});
});

describe("README images", () => {
	it("points every Package and Template README image at a committed file on main", () => {
		expect(absoluteReadmes().flatMap(absoluteImageViolations)).toEqual([]);
	});

	it("resolves every relative image in the root README", () => {
		const missing = imageSources(readFileSync(join(root, "README.md"), "utf8"))
			.filter((source) => !/^https?:/.test(source))
			.filter(
				(source) => !existsSync(join(root, source.split(/[?#]/)[0] ?? "")),
			);
		expect(missing).toEqual([]);
	});

	it("reads Markdown and HTML image sources", () => {
		expect(
			imageSources(`![a](${rawUrlPrefix}x.svg) <img width="1" src='y.svg'>`),
		).toEqual([`${rawUrlPrefix}x.svg`, "y.svg"]);
	});
});

describe("Package READMEs in the Blueprint shape", () => {
	const optedIn = readdirSync(join(root, "packages"))
		.map((name) => ({ file: join(root, "packages", name, "README.md"), name }))
		.filter(({ file }) => existsSync(file))
		.map(({ file, name }) => ({ markdown: readFileSync(file, "utf8"), name }))
		.filter(({ markdown }) => /^## Guarantees$/m.test(markdown));

	it("keeps every opted-in README to the section order", () => {
		expect(
			optedIn.flatMap(({ markdown, name }) =>
				blueprintViolations(name, markdown),
			),
		).toEqual([]);
	});

	it("accepts the shape and names each break", () => {
		const good = [
			"# @n8io/baseline-queue",
			"",
			"**Events in your Postgres.** More.",
			"",
			"```sh\npnpm add @n8io/baseline-queue\n```",
			"",
			"## Guarantees",
			"",
			"## Example",
			"",
			"```ts\nawait a();\n```",
			"",
			"## Reference",
			"",
			"**Needs** `DATABASE_URL`.",
		].join("\n");
		expect(blueprintViolations("queue", good)).toEqual([]);
		expect(
			blueprintViolations(
				"queue",
				good
					.replace("## Example", "## Usage")
					.replace("```ts\n", `\`\`\`ts\n${"a();\n".repeat(16)}`)
					.replace("**Needs** `DATABASE_URL`.", ""),
			),
		).toEqual([
			"packages/queue/README.md has the sections Guarantees, Example, Reference in that order, not Guarantees, Usage, Reference",
			"packages/queue/README.md keeps each example above Reference to 15 lines or fewer",
			"packages/queue/README.md ends on **Needs**",
		]);
	});
});

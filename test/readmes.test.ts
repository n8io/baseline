import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	readmeSvgDirectory,
	readmeSvgsRender,
} from "../scripts/readme-svg-write.ts";

// The rules these check are in docs/agents/readmes.md.
const root = resolve(import.meta.dirname, "..");
const rawUrlPrefix = "https://raw.githubusercontent.com/n8io/baseline/main/";

const committedSvgs = (): string[] =>
	readdirSync(join(root, readmeSvgDirectory))
		.filter((file) => file.endsWith(".svg"))
		.sort();

const motionMediaOpen = "@media (prefers-reduced-motion: no-preference){";

// The SVG with its motion-only media block cut out.
const motionBlockStrip = (svg: string): string => {
	const start = svg.indexOf(motionMediaOpen);
	if (start === -1) {
		return svg;
	}
	let depth = 0;
	for (
		let index = start + motionMediaOpen.length - 1;
		index < svg.length;
		index++
	) {
		depth += svg[index] === "{" ? 1 : svg[index] === "}" ? -1 : 0;
		if (depth === 0) {
			return svg.slice(0, start) + svg.slice(index + 1);
		}
	}
	return svg;
};

// Each SMIL animation sits on an element marked `moving`, or on a clipPath's rect (the typing
// reveal), so reduced motion can hide or unclip it.
const smilUnmarked = (svg: string): boolean =>
	[...svg.matchAll(/<(\w+)\b([^>]*)>\s*<animate/g)].some(
		(match) =>
			!/\bclass="[^"]*\bmoving\b/.test(match[2] ?? "") &&
			!(
				match[1] === "rect" &&
				/<clipPath\b[^>]*>\s*$/.test(svg.slice(0, match.index))
			),
	);

const svgViolations = (svg: string): string[] =>
	[
		/<title>[^<]*\S[^<]*<\/title>/.test(svg) ? undefined : "has no <title>",
		/<script/i.test(svg) ? "has a <script>" : undefined,
		/@import|@font-face/i.test(svg) ? "loads an external font" : undefined,
		/\s(?:xlink:)?(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(svg)
			? "references something outside the file"
			: undefined,
		/&(?!(?:#\d+|#x[\da-f]+|[a-z]+);)|<(?![a-z/!?])/i.test(svg)
			? "has an unescaped & or < (use svgText or svgEscape)"
			: undefined,
		svg.includes("@media (prefers-reduced-motion: reduce)")
			? undefined
			: "has no reduced-motion block",
		/animation\s*:|@keyframes/.test(motionBlockStrip(svg))
			? "animates outside motionCss"
			: undefined,
		smilUnmarked(svg)
			? "has SMIL on an element without class moving"
			: undefined,
	].filter((violation) => violation !== undefined);

// Fenced code blocks, blanked line for line, so nothing inside one counts.
const fencesBlank = (markdown: string): string =>
	markdown.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, (block) =>
		block.replace(/[^\n]/g, ""),
	);

type ReadmeImage = { alt: string; source: string };

// Images in Markdown (inline and reference) and HTML (`<img src>`, `<source srcset>`).
const readmeImages = (markdown: string): ReadmeImage[] => {
	const text = fencesBlank(markdown);
	const definitions = new Map(
		[...text.matchAll(/^\s*\[([^\]]+)\]:\s*<?([^\s>]+)/gm)].map((match) => [
			(match[1] ?? "").toLowerCase(),
			match[2] ?? "",
		]),
	);
	return [
		...[...text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)/g)].map((match) => ({
			alt: match[1] ?? "",
			source: match[2] ?? "",
		})),
		...[...text.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)].map((match) => ({
			alt: match[1] ?? "",
			source: definitions.get((match[2] || match[1] || "").toLowerCase()) ?? "",
		})),
		...[...text.matchAll(/<(img|source)\b([^>]*)>/gi)].map((match) => {
			const attributes = match[2] ?? "";
			const value = (name: string): string | undefined => {
				const found = new RegExp(
					`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
					"i",
				).exec(attributes);
				return found ? (found[1] ?? found[2] ?? found[3] ?? "") : undefined;
			};
			return {
				alt: match[1]?.toLowerCase() === "img" ? (value("alt") ?? "") : "-",
				source: (value("src") ?? value("srcset") ?? "").split(/[\s,]/)[0] ?? "",
			};
		}),
	];
};

const relativeIs = (source: string): boolean =>
	!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(source);

const committedFileIs = (path: string): boolean => {
	const clean = normalize(path.split(/[?#]/)[0] ?? "");
	const full = join(root, clean);
	return (
		clean !== "" &&
		!clean.startsWith("..") &&
		existsSync(full) &&
		statSync(full).isFile()
	);
};

// Every image has alt text, and every image in this repo is a committed file. Where npm or a
// Project shows the README outside this repo, `absolute` refuses relative paths.
const imageViolations = (file: string, absolute: boolean): string[] =>
	readmeImages(readFileSync(join(root, file), "utf8")).flatMap(
		({ alt, source }) => {
			const problems: string[] = [];
			if (alt.trim() === "") {
				problems.push(`${file}: ${source} has no alt text`);
			}
			if (relativeIs(source)) {
				if (absolute) {
					problems.push(`${file}: ${source} must be ${rawUrlPrefix}<path>`);
				} else if (!committedFileIs(source)) {
					problems.push(`${file}: ${source} is not a committed file`);
				}
			} else if (
				source.startsWith(rawUrlPrefix) &&
				!committedFileIs(source.slice(rawUrlPrefix.length))
			) {
				problems.push(`${file}: ${source} is not a committed file`);
			}
			return problems;
		},
	);

const absoluteReadmes = (): string[] =>
	[
		"apps/app/README.md",
		...readdirSync(join(root, "packages")).map(
			(name) => `packages/${name}/README.md`,
		),
	].filter((file) => existsSync(join(root, file)));

// Every Package README has the Blueprint shape: title, promise, install, Guarantees, Example,
// Reference, and it ends on Needs.
const blueprintSections = ["Guarantees", "Example", "Reference"];

const blueprintViolations = (name: string, markdown: string): string[] => {
	const lines = markdown.trimEnd().split("\n");
	const sections = fencesBlank(markdown)
		.split("\n")
		.filter((line) => line.startsWith("## "))
		.map((line) => line.slice(3).trim());
	const top = markdown.split("\n## ")[0] ?? "";
	const beforeReference = markdown.split("\n## Reference")[0] ?? "";
	const longExamples = [
		...beforeReference.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm),
	].filter((match) => (match[1] ?? "").trimEnd().split("\n").length > 15);
	const foldsClosedTight = lines.filter(
		(line, index) => line === "</details>" && (lines[index - 1] ?? "") !== "",
	).length;
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
		foldsClosedTight === 0
			? undefined
			: "leaves a blank line before each </details>",
		lines.at(-1)?.startsWith("**Needs**") ? undefined : "ends on **Needs**",
	]
		.filter((violation) => violation !== undefined)
		.map((violation) => `packages/${name}/README.md ${violation}`);
};

describe("README SVGs", () => {
	it("commits exactly what `pnpm readme-svg` writes", async () => {
		const rendered = await readmeSvgsRender();
		expect(rendered.size).toBeGreaterThan(0);
		expect(
			committedSvgs(),
			"docs/readme has a file no generator writes: delete it, or run pnpm readme-svg",
		).toEqual([...rendered.keys()].map((name) => `${name}.svg`).sort());
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
		const good = `<svg xmlns="http://www.w3.org/2000/svg"><title>t</title><style>@media (prefers-reduced-motion: no-preference){@keyframes a{0%{opacity:0}}.b{animation:a 1s}}
@media (prefers-reduced-motion: reduce){}</style><defs><clipPath id="c"><rect><animate attributeName="width"/></rect></clipPath></defs><text fill="url(#g)">Set up https://github.com/you/acme &amp; Result&lt;T&gt;</text><circle class="moving"><animateMotion/></circle></svg>`;
		expect(svgViolations(good)).toEqual([]);
		expect(svgViolations(good.replace("<title>t</title>", ""))).toEqual([
			"has no <title>",
		]);
		expect(svgViolations(`${good}<script/>`)).toEqual(["has a <script>"]);
		expect(svgViolations(`${good}<style>@import url(#a)</style>`)).toEqual([
			"loads an external font",
		]);
		expect(svgViolations(`${good}<image href="a.png"/>`)).toEqual([
			"references something outside the file",
		]);
		expect(svgViolations(good.replace("&amp;", "&"))).toEqual([
			"has an unescaped & or < (use svgText or svgEscape)",
		]);
		expect(
			svgViolations(good.replace("prefers-reduced-motion: reduce", "x")),
		).toEqual(["has no reduced-motion block"]);
		expect(svgViolations(`${good}<g style="animation:a 1s"/>`)).toEqual([
			"animates outside motionCss",
		]);
		expect(svgViolations(good.replace(' class="moving"', ""))).toEqual([
			"has SMIL on an element without class moving",
		]);
	});
});

describe("README images", () => {
	it("points every Package and Template README image at an absolute URL, with alt text", () => {
		expect(
			absoluteReadmes().flatMap((file) => imageViolations(file, true)),
		).toEqual([]);
	});

	it("resolves every image in the root README, with alt text", () => {
		expect(imageViolations("README.md", false)).toEqual([]);
	});

	it("reads every image form, outside code blocks", () => {
		expect(
			readmeImages(
				[
					`![a](${rawUrlPrefix}x.svg) <img width="1" data-src="n" src='y.svg' alt="b">`,
					'![c][ref] <picture><source srcset="z.svg 2x, w.svg"></picture>',
					"```md\n![skip](skip.svg)\n```",
					"[ref]: r.svg",
				].join("\n"),
			),
		).toEqual([
			{ alt: "a", source: `${rawUrlPrefix}x.svg` },
			{ alt: "c", source: "r.svg" },
			{ alt: "b", source: "y.svg" },
			{ alt: "-", source: "z.svg" },
		]);
	});
});

describe("Package READMEs in the Blueprint shape", () => {
	const packages = readdirSync(join(root, "packages"))
		.map((name) => ({ file: join(root, "packages", name, "README.md"), name }))
		.filter(({ file }) => existsSync(join(file, "..", "package.json")));

	it("gives every Package a README", () => {
		expect(
			packages.filter(({ file }) => !existsSync(file)).map(({ name }) => name),
		).toEqual([]);
	});

	it("keeps every Package README to the section order", () => {
		expect(
			packages
				.filter(({ file }) => existsSync(file))
				.map(({ file, name }) => ({
					markdown: readFileSync(file, "utf8"),
					name,
				}))
				.flatMap(({ markdown, name }) => blueprintViolations(name, markdown)),
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
			'```ts title="x"\nawait a();\n```',
			"",
			"```md\n## Not a section\n```",
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
					.replace("```ts", `\`\`\`ts\n${"a();\n".repeat(16)}`)
					.replace(
						"## Reference\n",
						"## Reference\n\n<details>\nx\n</details>\n",
					)
					.replace("**Needs** `DATABASE_URL`.", ""),
			),
		).toEqual([
			"packages/queue/README.md has the sections Guarantees, Example, Reference in that order, not Guarantees, Usage, Reference",
			"packages/queue/README.md keeps each example above Reference to 15 lines or fewer",
			"packages/queue/README.md leaves a blank line before each </details>",
			"packages/queue/README.md ends on **Needs**",
		]);
	});
});

// The text edits --reads makes to foo's files. Each one inserts at an anchor line that must occur
// exactly once, so a file that drifted fails loudly rather than being edited in the wrong place.
import { dirname, relative } from "node:path";
import { importEnd } from "./model-create-wiring.ts";

// Inserts before the anchor line, after it, or above the comment block that leads into it, so an
// anchor is code or a `// wiring:` marker and rewording a prose comment breaks nothing.
export const linesAt = ({
	anchor,
	lines,
	path,
	text,
	where = "before",
}: {
	anchor: string;
	lines: string[];
	path: string;
	text: string;
	where?: "after" | "before" | "aboveComment";
}): string => {
	const all = text.split("\n");
	const found = all.indexOf(anchor);
	if (found === -1 || all.indexOf(anchor, found + 1) !== -1) {
		throw new Error(`${path}: --reads needs exactly one line "${anchor}"`);
	}
	let at = where === "after" ? found + 1 : found;
	while (where === "aboveComment" && /^\s*\/\//.test(all[at - 1] ?? "")) at--;
	all.splice(at, 0, ...lines);
	return all.join("\n");
};

export const importsAfter = (text: string, imports: string[]): string => {
	const lines = text.split("\n");
	lines.splice(importEnd(lines) + 1, 0, ...imports);
	return lines.join("\n");
};

// The calls that build foo's ports or foo itself, which a context that reads needs its upstream
// for: fooPortsMemoryCreate() gets it as its argument, fooPortsCreate(connections) as its second,
// and fooContextCreate({ connections }) as a field.
export const upstreamCallsExtend = (text: string): string => {
	let out = text;
	for (const call of [
		"fooPortsMemoryCreate(",
		"fooPortsCreate(",
		"fooContextCreate(",
	]) {
		let next = "";
		let from = 0;
		for (let at = out.indexOf(call); at !== -1; at = out.indexOf(call, from)) {
			// A call a comment names is no call.
			const lineStart = out.lastIndexOf("\n", at) + 1;
			if (out.slice(lineStart, at).trimStart().startsWith("//")) {
				next += out.slice(from, at + call.length);
				from = at + call.length;
				continue;
			}
			let depth = 1;
			let k = at + call.length;
			while (depth > 0 && k < out.length) {
				if (out[k] === "(") depth++;
				if (out[k] === ")") depth--;
				k++;
			}
			const inside = out.slice(at + call.length, k - 1).replace(/,\s*$/, "");
			const extended =
				call === "fooContextCreate("
					? inside.replace(/,?\s*\}\s*$/, ", upstream }")
					: inside.trim() === ""
						? "upstream"
						: `${inside}, upstream`;
			next += `${out.slice(from, at)}${call}${extended})`;
			from = k;
		}
		out = next + out.slice(from);
	}
	return out;
};

// A test that builds foo's ports or foo itself builds foo's upstream once, for real on memory.
// The file shares it: Foo's tests never write upstream rows, and a test that does builds its own.
export const upstreamTestBuild = ({
	path,
	text,
}: {
	path: string;
	text: string;
}): string => {
	const helper = relative(
		dirname(path),
		"src/contexts/foo/adapters/outbound/foo-test-upstream.ts",
	);
	const specifier = helper.startsWith(".") ? helper : `./${helper}`;
	return linesAt({
		text: importsAfter(upstreamCallsExtend(text), [
			`import { fooTestUpstreamCreate } from "${specifier}";`,
		]),
		path,
		where: "after",
		anchor: `import { fooTestUpstreamCreate } from "${specifier}";`,
		lines: [
			"",
			"// The contexts this context reads, built for real on memory adapters.",
			"const upstream = await fooTestUpstreamCreate();",
		],
	});
};

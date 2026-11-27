// glossary-check's prose: the comments and string literals of a file with the code blanked.
import { modesRead } from "./template-render.ts";

export const glossaryFileIsSkipped = (file: string): boolean =>
	/(^|\/)CONTEXT(-MAP)?\.md$/.test(file) ||
	/(^|\/)migrations\//.test(file) ||
	file.endsWith(".json");

// Every line of a code file with everything but prose blanked: only comments and string literals
// stay (a string that is a `kind:` value does not), so identifiers, keys and JSX element names never
// match. The lexer reads JSX text as code, so a .tsx file also keeps what sits between a tag's `>` and
// the next `<` or `{` (jsxTextIs; text after a `{...}` is not read). Lexed once per file.
// A tag's `>` follows a name, a quote or a `}`; text then runs to the next `<` or `{`. Operators
// (`=>`, `>=`), generics followed by a call or an assignment, and code with `;` `=` `|` `(` `)` do not match.
const jsxTextPattern =
	/(?<=[\w"'}\]])>([^<>{};=|&()]*[A-Za-z][^<>{};=|&()]*)(?=[<{])/g;

export const kindValuePattern = /\bkind:\s*(["'])[^"'\n]*\1/g;

const codeIs = (mode: string | undefined): boolean =>
	mode === undefined || mode === "code";

const jsxTextIs = ({
	modes,
	text,
}: {
	modes: ReturnType<typeof modesRead>;
	text: string;
}): boolean[] => {
	const is = new Array<boolean>(text.length).fill(false);
	for (const m of text.matchAll(jsxTextPattern)) {
		const from = m.index + 1;
		const to = from + (m[1]?.length ?? 0);
		// Only code counts: a `>` inside a string or comment starts no tag.
		if (!codeIs(modes[m.index])) continue;
		for (let k = from; k < to; k++) is[k] = codeIs(modes[k]);
	}
	return is;
};

export const glossaryProseLines = ({
	file,
	text,
}: {
	file: string;
	text: string;
}): string[] => {
	const modes = modesRead(text, file);
	const skipped = new Map<number, boolean>();
	const kindValueIs = (index: number): boolean => {
		let from = index;
		while (from > 0 && modes[from - 1] === "string") from--;
		let value = skipped.get(from);
		if (value === undefined) {
			value = /\bkind:\s*$/.test(text.slice(Math.max(0, from - 40), from));
			skipped.set(from, value);
		}
		return value;
	};
	const jsx = file.endsWith(".tsx")
		? jsxTextIs({ modes, text })
		: new Array<boolean>(text.length).fill(false);
	let prose = "";
	for (let i = 0; i < text.length; i++) {
		const mode = modes[i];
		const keep =
			text[i] === "\n" ||
			jsx[i] === true ||
			mode === "comment" ||
			(mode === "string" && !kindValueIs(i));
		prose += keep ? (text[i] ?? " ") : " ";
	}
	return prose.split("\n");
};

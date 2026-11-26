// Renaming foo to another context or Model.
import { fooPattern, type Mode, modesRead } from "./template-render-scan.ts";
import type { NameForms } from "./template-render-types.ts";

export const camelFromKebab = (kebab: string): string =>
	kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const pascalFromKebab = (kebab: string): string => {
	const camel = camelFromKebab(kebab);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
};

const jsxKeywords = new Set([
	"as",
	"extends",
	"in",
	"instanceof",
	"of",
	"satisfies",
]);

// JSX text (`<h1>Foos</h1>`, `Back to foos`) is UI copy, not an identifier.
const fooProseIs = ({
	end,
	start,
	text,
}: {
	end: number;
	start: number;
	text: string;
}): boolean => {
	const next = text[end] ?? "";
	if (/[A-Za-z0-9_]/.test(next)) return false;
	if (text[start - 1] === ">" || next === "<") return true;
	if (next === "?" && !/[.:]/.test(text[end + 1] ?? "")) return true;
	const word = /^ ([a-z]+)/.exec(text.slice(end))?.[1];
	if (word !== undefined && !jsxKeywords.has(word)) return true;
	const lineStart = text.lastIndexOf("\n", start) + 1;
	const lineEnd = text.indexOf("\n", end);
	const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
	return /^\s*[A-Z]/.test(line) && !/[;(){}=<>"'`]/.test(line);
};

type Form = "camel" | "constant" | "kebab" | "snake" | "words";

// Which spelling an occurrence of foo takes, from where it stands.
const formPick = ({
	end,
	modes,
	path,
	start,
	text,
}: {
	end: number;
	modes: Mode[];
	path: string;
	start: number;
	text: string;
}): Form => {
	const token = text.slice(start, end);
	const next = text[end] ?? "";
	const previous = text[start - 1] ?? "";
	if (token.startsWith("FOO")) return "constant";
	if (next === "_") return "snake";
	if (/[A-Z0-9]/.test(next)) return "camel";
	if (modes[start] === "code") {
		return path.endsWith(".tsx") && fooProseIs({ text, start, end })
			? "words"
			: "camel";
	}
	if (text.slice(start - 9, start) === "baseline.") return "snake";
	if (text.slice(start - 6, start) === "/live/") return "snake";
	// An OpenAPI tag is the prefix of its operationIds: tags: ["invoiceLine"] beside "invoiceLineGet".
	if (text.slice(start - 8, start) === 'tags: ["') return "camel";
	const quoted = /["'`]/.test(previous) && next === previous;
	if (quoted) return token.endsWith("s") ? "kebab" : "snake";
	if (/[.:]/.test(next) && /[a-z]/.test(text[end + 1] ?? "")) return "kebab";
	if (next === "-" || next === "/" || /[-/.:#]/.test(previous)) return "kebab";
	return "words";
};

const spell = ({
	form,
	names,
	plural,
	token,
}: {
	form: Form;
	names: NameForms;
	plural: boolean;
	token: string;
}): string => {
	const kebab = plural ? names.plural : names.kebab;
	const upper = token.startsWith("F");
	switch (form) {
		case "constant":
			return kebab.replaceAll("-", "_").toUpperCase();
		case "snake":
			return kebab.replaceAll("-", "_");
		case "kebab":
			return kebab;
		case "words": {
			const words = kebab.replaceAll("-", " ");
			return upper ? words.charAt(0).toUpperCase() + words.slice(1) : words;
		}
		case "camel":
			return upper ? pascalFromKebab(kebab) : camelFromKebab(kebab);
	}
};

// Renames every foo in a file's text: fooCreate → invoiceLineCreate, FOO_X → INVOICE_LINE_X,
// pgSchema("foo") → "invoice_line", "/foos" → "/invoice-lines", "foo:read" → "invoice-line:read".
export const fooRename = ({
	names,
	path,
	text,
}: {
	names: NameForms;
	path: string;
	text: string;
}): string => {
	const modes = modesRead(text, path);
	return text.replace(
		fooPattern,
		// biome-ignore lint/complexity/useMaxParams: String.replace passes each match this way.
		(token: string, base: string, s: string, start: number) =>
			spell({
				names,
				form: formPick({ text, modes, start, end: start + token.length, path }),
				token: base,
				plural: s === "s",
			}),
	);
};

export const fooPathRename = (path: string, names: NameForms): string =>
	path
		.replace(/(^|\/)foos(?=[-./]|$)/g, `$1${names.plural}`)
		.replace(/(^|\/|-)foo(?=[-./]|$)/g, `$1${names.kebab}`);

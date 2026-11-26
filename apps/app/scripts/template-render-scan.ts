// Matching foo: tells code from strings and comments, so a rename or a removal never touches the wrong text.

// foo, Foo, FOO and the plurals foos, Foos, never part of a longer lowercase word (footer).
export const fooPattern = /(foo|Foo|FOO)(s?)(?![a-z])/g;

export const lineIsFoo = (line: string): boolean => {
	fooPattern.lastIndex = 0;
	return fooPattern.test(line);
};

export type Mode = "code" | "string" | "comment";

export const fileIsCode = (path: string): boolean =>
	/\.(ts|tsx|js|mjs)$/.test(path);

export const regexCanStart = /[(,=:[!&|?{};+\-*%~^]/;
const regexKeywords =
	/\b(return|typeof|case|do|else|in|of|void|yield|await|throw)\s*$/;

// A small lexer: the mode of every character, so renames and bracket counts can tell
// code from strings and comments. JSX text reads as code; fooProseIs handles it.
export const modesRead = (text: string, path: string): Mode[] => {
	const modes: Mode[] = new Array(text.length);
	if (!fileIsCode(path)) return modes.fill("comment");
	const templateDepths: number[] = [];
	let braceDepth = 0;
	let i = 0;
	let previous = "";
	const mark = ({
		from,
		mode,
		to,
	}: {
		from: number;
		mode: Mode;
		to: number;
	}) => {
		for (let k = from; k < to && k < text.length; k++) modes[k] = mode;
	};
	const stringSkip = (quote: string): number => {
		let k = i + 1;
		while (k < text.length && text[k] !== quote && text[k] !== "\n") {
			k += text[k] === "\\" ? 2 : 1;
		}
		return k + 1;
	};
	const templateSkip = (from: number): number => {
		let k = from;
		while (k < text.length) {
			if (text[k] === "\\") k += 2;
			else if (text[k] === "`") return k + 1;
			else if (text[k] === "$" && text[k + 1] === "{") return -(k + 2);
			else k++;
		}
		return k;
	};
	while (i < text.length) {
		const c = text[i] ?? "";
		const next = text[i + 1];
		if (c === "/" && next === "/") {
			const end = text.indexOf("\n", i);
			const to = end === -1 ? text.length : end;
			mark({ from: i, to, mode: "comment" });
			i = to;
		} else if (c === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			const to = end === -1 ? text.length : end + 2;
			mark({ from: i, to, mode: "comment" });
			i = to;
		} else if (c === '"' || c === "'") {
			const to = stringSkip(c);
			mark({ from: i, to, mode: "string" });
			i = to;
			previous = c;
		} else if (
			c === "/" &&
			(previous === "" ||
				regexCanStart.test(previous) ||
				regexKeywords.test(text.slice(Math.max(0, i - 12), i)))
		) {
			let k = i + 1;
			let inClass = false;
			while (k < text.length && text[k] !== "\n") {
				if (text[k] === "\\") k++;
				else if (text[k] === "[") inClass = true;
				else if (text[k] === "]") inClass = false;
				else if (text[k] === "/" && !inClass) break;
				k++;
			}
			mark({ from: i, to: text[k] === "\n" ? k : k + 1, mode: "string" });
			i = text[k] === "\n" ? k : k + 1;
			previous = "/";
		} else if (
			c === "`" ||
			(c === "}" && templateDepths.at(-1) === braceDepth)
		) {
			if (c === "}") templateDepths.pop();
			const to = templateSkip(i + 1);
			const end = Math.abs(to);
			mark({ from: i, to: end, mode: "string" });
			if (to < 0) templateDepths.push(braceDepth);
			i = end;
			previous = "`";
		} else {
			if (c === "{") braceDepth++;
			if (c === "}") braceDepth--;
			modes[i] = "code";
			if (!/\s/.test(c)) previous = c;
			i++;
		}
	}
	return modes;
};

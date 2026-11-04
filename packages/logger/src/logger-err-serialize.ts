// The only error shape that leaves the process: class name, code,
// constraint and stack frames, down the cause chain. Never message or detail,
// because both can hold input text.
export type LoggerErr = {
	cause?: LoggerErr;
	code?: number | string;
	constraint?: string;
	stack?: string;
	type: string;
};

const causeDepthMax = 10;
const stackFrame = /^\s+at /;

const errType = (value: unknown): string => {
	if (value instanceof Error) {
		return value.constructor.name || "Error";
	}
	return value === null ? "null" : typeof value;
};

// Keeps only "at ..." frames. Everything up to the end of the message goes first,
// so a message spanning several lines cannot leave a line behind. The message is
// matched as text, not as "name: message", because pg sets name to "error".
const stackFrames = (error: Error): string | undefined => {
	if (typeof error.stack !== "string") {
		return undefined;
	}
	const at = error.message === "" ? -1 : error.stack.indexOf(error.message);
	const body =
		at === -1 ? error.stack : error.stack.slice(at + error.message.length);
	const frames = body
		.split("\n")
		.filter((line) => stackFrame.test(line))
		.map((line) => line.trim());
	return frames.length > 0 ? frames.join("\n") : undefined;
};

const errSerialize = (value: unknown, depth: number): LoggerErr => {
	const shape: LoggerErr = { type: errType(value) };
	if (!(value instanceof Error)) {
		return shape;
	}
	const { code, constraint } = value as {
		code?: unknown;
		constraint?: unknown;
	};
	if (typeof code === "string" || typeof code === "number") {
		shape.code = code;
	}
	if (typeof constraint === "string") {
		shape.constraint = constraint;
	}
	const stack = stackFrames(value);
	if (stack !== undefined) {
		shape.stack = stack;
	}
	if (value.cause !== undefined && depth < causeDepthMax) {
		shape.cause = errSerialize(value.cause, depth + 1);
	}
	return shape;
};

export const loggerErrSerialize = (value: unknown): LoggerErr =>
	errSerialize(value, 0);

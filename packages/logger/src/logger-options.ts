import type { LoggerOptions } from "pino";
import { loggerErrSerialize } from "./logger-err-serialize.ts";

// A second line of defence behind the allowlist: credentials at the top level,
// one level down, and in request or response headers.
const fieldsSecret = [
	"accessToken",
	"access_token",
	"apiKey",
	"authorization",
	"cookie",
	"idToken",
	"id_token",
	"password",
	"refreshToken",
	"refresh_token",
	"set-cookie",
	"token",
];

// pino redact paths need bracket syntax for a key that is not an identifier.
const keyPath = (prefix: string, key: string): string =>
	/^\w+$/.test(key)
		? `${prefix}${prefix === "" ? "" : "."}${key}`
		: `${prefix}["${key}"]`;

export const loggerRedactPaths: readonly string[] = fieldsSecret.flatMap(
	(field) =>
		["", "*", "*.headers", "*.*.headers"].map((prefix) =>
			keyPath(prefix, field),
		),
);

const errFind = (first: unknown): unknown => {
	if (first instanceof Error) {
		return first;
	}
	if (typeof first === "object" && first !== null && "err" in first) {
		return first.err;
	}
	return undefined;
};

export const loggerOptions = (level: string): LoggerOptions => ({
	hooks: {
		// pino copies err.message into msg when a call gives no message. Use the
		// class name instead, so no message text reaches a log record.
		logMethod(args, method) {
			const [first, second] = args;
			const err = errFind(first);
			if (err !== undefined && typeof second !== "string") {
				const type = loggerErrSerialize(err).type;
				return method.apply(this, [first, type]);
			}
			return method.apply(this, args);
		},
	},
	level,
	redact: { censor: "[Redacted]", paths: [...loggerRedactPaths] },
	serializers: { err: loggerErrSerialize },
});

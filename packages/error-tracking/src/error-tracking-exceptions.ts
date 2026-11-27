import type { LoggerErr } from "@n8io/baseline-logger/err-serialize";
import {
	createStackParser,
	type Exception,
	type StackParser,
} from "@sentry/core";
import { nodeStackLineParser } from "@sentry/core/server";

/** Parses a stack string into frames, as the report and the client both need. */
export const errorTrackingStackParser: StackParser = createStackParser(
	nodeStackLineParser(),
);

// The report is built from loggerErrSerialize's safe shape, the one definition of what may leave
// the process: class names, codes, constraints and stack frames, innermost cause first, as Sentry
// orders them. The error itself never reaches Sentry, so no message can.
export const errorTrackingExceptionsCreate = (err: LoggerErr): Exception[] => {
	const exceptions: Exception[] = [];
	for (let at: LoggerErr | undefined = err; at; at = at.cause) {
		exceptions.unshift({
			stacktrace: { frames: errorTrackingStackParser(at.stack ?? "") },
			type: at.type,
		});
	}
	return exceptions.map((exception, index) =>
		index === exceptions.length - 1
			? { ...exception, mechanism: { handled: true, type: "generic" } }
			: exception,
	);
};

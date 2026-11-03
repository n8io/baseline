import { loggerErrSerialize } from "@n8io/baseline-logger";
import type { Result } from "@n8io/baseline-result";
import {
	type Attributes,
	metrics,
	SpanKind,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";

type UseCase = (...args: never[]) => Promise<Result<unknown, { type: string }>>;

const scope = "@n8io/baseline-telemetry";

// The semconv duration buckets, in seconds.
const durationBuckets = [
	0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

// Wraps each use case in one INTERNAL span named after it and records
// baseline.use_case.duration. An err result is an expected outcome: status
// stays Unset and error.type holds its type. A throw sets status Error with the
// class name, and is rethrown for whoever catches it to log once.
export const telemetryUseCasesTrace = <U extends Record<string, UseCase>>(
	useCases: U,
): U => {
	const tracer = trace.getTracer(scope);
	const duration = metrics
		.getMeter(scope)
		.createHistogram("baseline.use_case.duration", {
			advice: { explicitBucketBoundaries: durationBuckets },
			description: "Duration of use case calls.",
			unit: "s",
		});
	const wrapped = Object.entries(useCases).map(([name, useCase]) => {
		const traced = (...args: never[]) =>
			tracer.startActiveSpan(
				name,
				{
					attributes: { "code.function.name": name },
					kind: SpanKind.INTERNAL,
				},
				async (span) => {
					const started = performance.now();
					const attributes: Attributes = { "code.function.name": name };
					try {
						const result = await useCase(...args);
						if (!result.ok) {
							attributes["error.type"] = result.error.type;
							span.setAttribute("error.type", result.error.type);
						}
						return result;
					} catch (error) {
						const type = loggerErrSerialize(error).type;
						attributes["error.type"] = type;
						span.setAttribute("error.type", type);
						span.setStatus({ code: SpanStatusCode.ERROR, message: type });
						throw error;
					} finally {
						duration.record((performance.now() - started) / 1000, attributes);
						span.end();
					}
				},
			);
		return [name, traced] as const;
	});
	return Object.fromEntries(wrapped) as U;
};

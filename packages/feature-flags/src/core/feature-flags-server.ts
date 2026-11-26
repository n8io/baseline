import {
	type FeatureFlagContextResolved,
	type FeatureFlagKinds,
	featureFlagsContextFreeze,
} from "./feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "./feature-flags-define-types.ts";
import { featureFlagsEvaluationReport } from "./feature-flags-evaluation-report.ts";
import { featureFlagsFallbackReport } from "./feature-flags-fallback-report.ts";
import { featureFlagsRecoveredReport } from "./feature-flags-recovered-report.ts";
import { featureFlagsResolve } from "./feature-flags-resolve.ts";
import type {
	FeatureFlagFallback,
	FeatureFlagRead,
} from "./feature-flags-resolve-types.ts";

import type {
	FeatureFlags,
	FeatureFlagsHandle,
	FeatureFlagsServerOptions,
} from "./feature-flags-server-types.ts";

const silentReasons: ReadonlySet<string> = new Set(["closed", "notReady"]);

/**
 * Builds the server's flags from an adapter's source: the type checks, fallbacks, logging and
 * lifecycle every adapter shares. A flag service's answer of the wrong type, outside `values`, or
 * failing `schema` reads as the fallback; so does an outage, a missing flag and a closed instance.
 */
export const featureFlagsServerCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	flags,
	onEvaluation,
	onFallback,
	onRecovered,
	source,
}: FeatureFlagsServerOptions<D, K>): FeatureFlags<D, K> => {
	let settled = false;
	let down = false;
	// Counts outage state changes, so a read that began before one cannot undo it when it ends.
	let epoch = 0;
	let closing: Promise<void> | undefined;
	const notFoundReported = new Set<string>();
	const ready = source.ready.then(
		(status) => {
			settled = true;
			return status;
		},
		() => {
			settled = true;
			return "failed" as const;
		},
	);
	const report = (fallback: FeatureFlagFallback): void => {
		if (silentReasons.has(fallback.reason)) {
			return;
		}
		if (fallback.reason === "notFound") {
			if (notFoundReported.has(fallback.flag)) {
				return;
			}
			notFoundReported.add(fallback.flag);
		}
		featureFlagsFallbackReport({ fallback, onFallback });
	};
	const get = async (
		flag: string,
		context: FeatureFlagContextResolved,
	): Promise<unknown> => {
		const definition = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
		if (definition === undefined) {
			report({ flag, key: "", reason: "notFound" });
			return undefined;
		}
		const evaluated = ({
			fallbackReason,
			read,
			value,
		}: {
			fallbackReason: FeatureFlagFallback["reason"] | null;
			read?: FeatureFlagRead | undefined;
			value: unknown;
		}): unknown => {
			featureFlagsEvaluationReport({
				evaluation: {
					fallbackReason,
					flag,
					key: definition.key,
					// A fallback was not the service's value, so its reason and variant do not describe it.
					reason:
						fallbackReason === null && read?.found
							? (read.reason ?? null)
							: null,
					value,
					variant:
						fallbackReason === null && read?.found
							? (read.variant ?? null)
							: null,
				},
				onEvaluation,
			});
			return value;
		};
		const fallbackFor = (
			reason: FeatureFlagFallback["reason"],
			from?: { read: FeatureFlagRead; startEpoch: number },
		): unknown => {
			// An outage is reported when it starts. Each read in it still returns the fallback. A
			// read that began before a state change, or finished after close(), changes nothing.
			if (reason === "vendorError") {
				if (closing === undefined && from?.startEpoch === epoch && !down) {
					down = true;
					epoch += 1;
					report({ flag, key: definition.key, reason });
				}
			} else {
				report({ flag, key: definition.key, reason });
			}
			return evaluated({
				fallbackReason: reason,
				read: from?.read,
				value: definition.fallback,
			});
		};
		if (closing !== undefined) {
			return fallbackFor("closed");
		}
		if (!settled) {
			return fallbackFor("notReady");
		}
		const startEpoch = epoch;
		// An async wrapper, so a source that throws before it returns a Promise is caught too.
		const read = await (async () =>
			source.read({
				context,
				fallback: definition.fallback,
				key: definition.key,
			}))().catch(
			(): FeatureFlagRead => ({ found: false, reason: "vendorError" }),
		);
		if (
			down &&
			closing === undefined &&
			startEpoch === epoch &&
			(read.found || read.reason !== "vendorError")
		) {
			down = false;
			epoch += 1;
			featureFlagsRecoveredReport(onRecovered);
		}
		const resolved = featureFlagsResolve({ definition, read });
		return resolved.reason === null
			? evaluated({ fallbackReason: null, read, value: resolved.value })
			: fallbackFor(resolved.reason, { read, startEpoch });
	};
	const close = (): Promise<void> => {
		closing ??= (async () => source.close())().catch(() => undefined);
		return closing;
	};
	return {
		close,
		context: (context) => {
			const frozen = featureFlagsContextFreeze(context);
			return {
				// boundary: the value was checked against the flag's definition by featureFlagsResolve
				get: ((flag: string) =>
					get(flag, frozen)) as FeatureFlagsHandle<D>["get"],
			};
		},
		ready,
		[Symbol.asyncDispose]: close,
	};
};

import type { FeatureFlagsClientSource } from "./feature-flags-client.ts";
import type { FeatureFlagContextResolved } from "./feature-flags-context.ts";
import type {
	FeatureFlagDefinitions,
	FlagValue,
} from "./feature-flags-define.ts";
import type {
	FeatureFlagRead,
	FeatureFlagsReadyStatus,
} from "./feature-flags-resolve.ts";
import type { FeatureFlagsServerSource } from "./feature-flags-server.ts";

/** Values for some flags, by the name code reads them with, each typed as its flag. */
export type FeatureFlagMemoryValues<D extends FeatureFlagDefinitions> = {
	readonly [N in keyof D]?: FlagValue<D[N]>;
};

/** Raw values by flag key, as a flag service would hold them: any type, to test a wrong one. */
export type FeatureFlagMemoryValuesByKey = (
	context: FeatureFlagContextResolved,
) => Readonly<Record<string, unknown>>;

/** Maps values written by flag name onto flag keys. A flag left out has no value in the service. */
export const featureFlagsMemorySourceValuesByKey =
	<D extends FeatureFlagDefinitions>({
		flags,
		values,
	}: {
		flags: D;
		values:
			| FeatureFlagMemoryValues<D>
			| ((context: FeatureFlagContextResolved) => FeatureFlagMemoryValues<D>);
	}): FeatureFlagMemoryValuesByKey =>
	(context) => {
		const named: Readonly<Record<string, unknown>> =
			typeof values === "function" ? values(context) : values;
		return Object.fromEntries(
			Object.entries(flags).flatMap(([name, definition]) =>
				Object.hasOwn(named, name) ? [[definition.key, named[name]]] : [],
			),
		);
	};

const readOf = ({
	key,
	ready,
	values,
}: {
	key: string;
	ready: FeatureFlagsReadyStatus;
	values: Readonly<Record<string, unknown>>;
}): FeatureFlagRead => {
	if (ready !== "connected") {
		return { found: false, reason: "vendorError" };
	}
	return Object.hasOwn(values, key)
		? { found: true, value: values[key] }
		: { found: false, reason: "notFound" };
};

/**
 * A server source that answers from memory. `ready` says how it settles (default `connected`);
 * anything else makes every read a vendor error, like an outage. Adapter contract tests use it
 * with raw values; tests use `featureFlagsMemoryCreate`.
 */
export const featureFlagsMemorySourceServerCreate = ({
	ready = "connected",
	values,
}: {
	ready?: FeatureFlagsReadyStatus | null;
	values: FeatureFlagMemoryValuesByKey;
}): FeatureFlagsServerSource => ({
	close: () => Promise.resolve(),
	read: ({ context, key }) =>
		Promise.resolve(
			readOf({ key, ready: ready ?? "connected", values: values(context) }),
		),
	ready: Promise.resolve(ready ?? "connected"),
});

/** A browser source that answers from memory, and changes its values on demand. */
export type FeatureFlagsMemorySourceClient = FeatureFlagsClientSource & {
	/** Replaces every value and notifies subscribers. */
	valuesSet(values: FeatureFlagMemoryValuesByKey): void;
};

/** The browser version of `featureFlagsMemorySourceServerCreate`. */
export const featureFlagsMemorySourceClientCreate = ({
	context,
	ready = "connected",
	values,
}: {
	context: FeatureFlagContextResolved;
	ready?: FeatureFlagsReadyStatus | null;
	values: FeatureFlagMemoryValuesByKey;
}): FeatureFlagsMemorySourceClient => {
	let current = { context, values };
	const status = ready ?? "connected";
	const listeners = new Set<() => void>();
	const notify = (): void => {
		for (const listener of [...listeners]) {
			listener();
		}
	};
	return {
		close: () => {
			listeners.clear();
			return Promise.resolve();
		},
		contextSet: (next) => {
			current = { ...current, context: next };
			notify();
			return Promise.resolve();
		},
		read: ({ key }) =>
			readOf({
				key,
				ready: status,
				values: current.values(current.context),
			}),
		ready: Promise.resolve(status),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		valuesSet: (next) => {
			current = { ...current, values: next };
			notify();
		},
	};
};

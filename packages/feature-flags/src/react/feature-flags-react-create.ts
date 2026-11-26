import {
	createContext,
	createElement,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useSyncExternalStore,
} from "react";
import type { FeatureFlagsBrowser } from "../core/feature-flags-client-types.ts";
import type {
	FeatureFlagDefinitions,
	FlagValue,
} from "../core/feature-flags-define-types.ts";
import type { FeatureFlagsReadyStatus } from "../core/feature-flags-resolve-types.ts";

type ProviderReady = Promise<FeatureFlagsReadyStatus> | FeatureFlagsReadyStatus;

/** What `<FeatureFlagsProvider>` takes. */
export type FeatureFlagsProviderProps<D extends FeatureFlagDefinitions> = {
	readonly children?: ReactNode;
	/** Shown until `ready` settles. Defaults to nothing. */
	readonly fallback?: ReactNode;
	/** The browser's `flags`, from the client the Project created. */
	readonly flags: FeatureFlagsBrowser<D>;
	/**
	 * The client's `ready`, or the status it settled with: pass the status when the page already
	 * awaited it (before hydrating) so the first render needs no wait. A promise must keep its
	 * identity between renders. Children render once it settles, whatever the status, because reads
	 * return fallbacks until the flags are in. Leave it out to render children at once.
	 */
	readonly ready?: ProviderReady | null;
};

/** The Provider and hook typed from the Project's flag declarations. */
export type FeatureFlagsReact<D extends FeatureFlagDefinitions> = {
	FeatureFlagsProvider(props: FeatureFlagsProviderProps<D>): ReactElement;
	/** The flag's current value, and a render again when that flag, and only that flag, changes. */
	useFeatureFlag<N extends keyof D & string>(flag: N): FlagValue<D[N]>;
};

// mutates: the record is ours, shared by every Provider of one promise, flipped when it settles
type Settled = { done: boolean };

/** What the Provider hands the hook: the client's reads and the declarations' fallbacks. */
type FlagsContextValue = {
	readonly defs: FeatureFlagDefinitions;
	readonly flags: FeatureFlagsBrowser<FeatureFlagDefinitions>;
};

// One record per ready promise, so every Provider asks the same question and the answer survives
// a re-render. A rejection counts as settled: the Provider never waits forever.
const settledByReady = new WeakMap<object, Settled>();

const settledOf = (ready: Promise<unknown>): Settled => {
	const known = settledByReady.get(ready);
	if (known !== undefined) {
		return known;
	}
	const settled: Settled = { done: false };
	const finish = (): void => {
		settled.done = true;
	};
	ready.then(finish, finish);
	settledByReady.set(ready, settled);
	return settled;
};

// The server renders children with fallback values: its reads cannot be ready. The browser awaits
// `ready` before hydrating and passes the status, which is settled on the first render, so the
// first client render matches. A promise that settled earlier reads as pending for one microtask.
const FlagsContext = createContext<FlagsContextValue | null>(null);

const settledServerSnapshot = (): boolean => true;

type ProviderRenderProps = {
	readonly children?: ReactNode;
	readonly fallback?: ReactNode;
	readonly flags: FeatureFlagsBrowser<FeatureFlagDefinitions>;
	readonly ready?: ProviderReady | null;
};

// A component and a hook are bound to the declarations, not defined inside the factory: React
// would treat a component defined in a function as new each call.
const providerRender = (
	defs: FeatureFlagDefinitions,
	{ children, fallback, flags, ready }: ProviderRenderProps,
): ReactElement => {
	const settled =
		ready === null || ready === undefined || typeof ready === "string"
			? null
			: settledOf(ready);
	const subscribe = useCallback(
		(notify: () => void): (() => void) => {
			if (ready === null || ready === undefined || typeof ready === "string") {
				return () => undefined;
			}
			const state = { live: true };
			const call = (): void => {
				if (state.live) {
					notify();
				}
			};
			ready.then(call, call);
			return () => {
				state.live = false;
			};
		},
		[ready],
	);
	const isSettled = useSyncExternalStore(
		subscribe,
		() => settled === null || settled.done,
		settledServerSnapshot,
	);
	const value = useMemo(() => ({ defs, flags }), [defs, flags]);
	return createElement(
		FlagsContext.Provider,
		{ value },
		isSettled ? children : (fallback ?? null),
	);
};

// boundary: a declared fallback is a value of the type the flag's definition gives the flag
const fallbackOf = (defs: FeatureFlagDefinitions, flag: string): unknown =>
	defs[flag]?.fallback;

const flagRead = (defs: FeatureFlagDefinitions, flag: string): unknown => {
	// A render outside a Provider reads the declared fallbacks, like a flag service that is down.
	const flags = useContext(FlagsContext)?.flags ?? null;
	const subscribe = useCallback(
		(notify: () => void): (() => void) =>
			flags === null ? () => undefined : flags.subscribe(flag, notify),
		[flags, flag],
	);
	const get = useCallback(
		(): unknown => (flags === null ? fallbackOf(defs, flag) : flags.get(flag)),
		[defs, flags, flag],
	);
	const getServerSnapshot = useCallback(
		(): unknown => fallbackOf(defs, flag),
		[defs, flag],
	);
	return useSyncExternalStore(subscribe, get, getServerSnapshot);
};

/**
 * Builds the Provider and the `useFeatureFlag` hook for a Project's flags. The argument is only
 * for its types and fallbacks: pass the object `featureFlagsDefine` returned. A flag name the
 * Project did not declare does not compile, and the hook returns the flag's own type.
 */
export const featureFlagsReactCreate = <const D extends FeatureFlagDefinitions>(
	flagDefs: D,
): FeatureFlagsReact<D> => ({
	// boundary: the bound functions are the generic ones with the declarations' type erased
	FeatureFlagsProvider: providerRender.bind(
		null,
		flagDefs,
	) as FeatureFlagsReact<D>["FeatureFlagsProvider"],
	useFeatureFlag: flagRead.bind(
		null,
		flagDefs,
	) as FeatureFlagsReact<D>["useFeatureFlag"],
});

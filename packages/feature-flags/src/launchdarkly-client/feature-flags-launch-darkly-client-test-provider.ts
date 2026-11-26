import {
	ErrorCode,
	type EvaluationContext,
	type JsonValue,
	OpenFeatureEventEmitter,
	type Provider,
	ProviderEvents,
	ProviderStatus,
	type ResolutionDetails,
} from "@openfeature/web-sdk";

/** What a fake LaunchDarkly provider needs: its raw values, and how its start goes. */
export type FakeProviderOptions = {
	readonly initialize?: "error" | "fail" | "hang" | "ok";
	readonly values: (
		context: EvaluationContext,
	) => Readonly<Record<string, unknown>>;
};

/**
 * An OpenFeature provider that answers like the LaunchDarkly one, from memory: a value of the
 * wrong type is a type mismatch (but any object, array or null counts as an object), a missing key
 * is not found, and a pushed change emits `ConfigurationChanged`.
 */
export class FakeProvider implements Provider {
	readonly events: OpenFeatureEventEmitter = new OpenFeatureEventEmitter();
	readonly metadata = { name: "fake" } as const;
	readonly runsOn = "client" as const;
	closed = 0;
	status: ProviderStatus = ProviderStatus.NOT_READY;
	private context: EvaluationContext = {};
	private values: FakeProviderOptions["values"];
	private readonly initializeAs: NonNullable<FakeProviderOptions["initialize"]>;

	constructor({ initialize = "ok", values }: FakeProviderOptions) {
		this.initializeAs = initialize;
		this.values = values;
	}

	initialize(context?: EvaluationContext): Promise<void> {
		this.context = context ?? {};
		if (this.initializeAs === "error") {
			this.status = ProviderStatus.ERROR;
			return Promise.resolve();
		}
		if (this.initializeAs === "fail") {
			return Promise.reject(new Error("no connection"));
		}
		this.status = ProviderStatus.READY;
		return this.initializeAs === "hang"
			? new Promise(() => undefined)
			: Promise.resolve();
	}

	onClose(): Promise<void> {
		this.closed += 1;
		return Promise.resolve();
	}

	onContextChange(
		_old: EvaluationContext,
		next: EvaluationContext,
	): Promise<void> {
		this.context = next;
		return Promise.resolve();
	}

	/** Changes what is served, as LaunchDarkly pushing a change would. */
	valuesSet(values: FakeProviderOptions["values"]): void {
		this.values = values;
		this.events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged: [] });
	}

	/** Emits Ready, as a provider that was slow to start does when it connects. */
	readyEmit(): void {
		this.status = ProviderStatus.READY;
		this.events.emit(ProviderEvents.Ready);
	}

	private resolve<T>({
		fallback,
		is,
		key,
	}: {
		fallback: T;
		is: (value: unknown) => value is T;
		key: string;
	}): ResolutionDetails<T> {
		const served = this.values(this.context);
		if (!Object.hasOwn(served, key)) {
			return {
				errorCode: ErrorCode.FLAG_NOT_FOUND,
				reason: "ERROR",
				value: fallback,
			};
		}
		const value = served[key];
		return is(value)
			? { reason: "STATIC", value }
			: {
					errorCode: ErrorCode.TYPE_MISMATCH,
					reason: "ERROR",
					value: fallback,
				};
	}

	resolveBooleanEvaluation(
		key: string,
		fallback: boolean,
	): ResolutionDetails<boolean> {
		return this.resolve({
			fallback,
			is: (value): value is boolean => typeof value === "boolean",
			key,
		});
	}

	resolveNumberEvaluation(
		key: string,
		fallback: number,
	): ResolutionDetails<number> {
		return this.resolve({
			fallback,
			is: (value): value is number => typeof value === "number",
			key,
		});
	}

	resolveObjectEvaluation<T extends JsonValue>(
		key: string,
		fallback: T,
	): ResolutionDetails<T> {
		return this.resolve({
			fallback,
			is: (value): value is T => typeof value === "object",
			key,
		});
	}

	resolveStringEvaluation(
		key: string,
		fallback: string,
	): ResolutionDetails<string> {
		return this.resolve({
			fallback,
			is: (value): value is string => typeof value === "string",
			key,
		});
	}
}

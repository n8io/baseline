/** How a kind's entry describes who or what a read is for. Values must be strings, numbers or booleans. */
export type FeatureFlagAttributes = Readonly<
	Record<string, string | number | boolean>
>;

/** One kind's entry in a context: who or what it is (`id`) and what targeting may use. */
export type FeatureFlagContextEntry = {
	readonly id: string;
	readonly attributes?: FeatureFlagAttributes | null;
};

/** The kinds a Project's context can hold, each `"required"` (a read needs it) or `"optional"`. */
export type FeatureFlagKinds = Readonly<
	Record<string, "optional" | "required">
>;

/**
 * One complete context: an entry for each kind the Project declared. A required kind left out
 * does not compile. A context is never merged or stacked; replace it whole.
 */
export type FeatureFlagContext<K extends FeatureFlagKinds> = {
	readonly [P in keyof K as K[P] extends "required"
		? P
		: never]: FeatureFlagContextEntry;
} & {
	readonly [P in keyof K as K[P] extends "optional"
		? P
		: never]?: FeatureFlagContextEntry | null;
};

/** A context as adapters see it: a frozen entry for each kind that was given. */
export type FeatureFlagContextResolved = Readonly<
	Record<string, FeatureFlagContextEntry>
>;

/** Copies a context into a frozen one without its empty kinds, so nothing can edit it later. */
export const featureFlagsContextFreeze = (
	context: Readonly<Record<string, FeatureFlagContextEntry | null | undefined>>,
): FeatureFlagContextResolved =>
	Object.freeze(
		Object.fromEntries(
			Object.entries(context).flatMap(([kind, entry]) =>
				entry === null || entry === undefined
					? []
					: [
							[
								kind,
								Object.freeze({
									id: entry.id,
									...(entry.attributes && {
										attributes: Object.freeze({ ...entry.attributes }),
									}),
								}),
							],
						],
			),
		),
	);

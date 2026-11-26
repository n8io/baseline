import type { Authn, AuthnState } from "./authn-types.ts";

const authnStates = new WeakMap<Authn, AuthnState>();

/** The state behind an `Authn`; throws a `TypeError` for anything `authnCreate` did not return. */
export const authnState = (authn: Authn, caller: string): AuthnState => {
	const state = authnStates.get(authn);
	if (state === undefined) {
		throw new TypeError(`${caller}: authn must come from authnCreate`);
	}
	return state;
};

export const authnFromState = (state: AuthnState): Authn => {
	const authn = Object.freeze({}) as Authn;
	authnStates.set(authn, state);
	return authn;
};

import { errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Actor } from "./actor.ts";
import { actorSchema } from "./actor-schema.ts";
import type { AuthnOptions, AuthnState } from "./authn-types.ts";

// What jose throws for a token that is wrong in itself. Anything else, such as a JWKS fetch that
// fails, times out, answers non-200 or returns a bad key set, is an outage (500), never a reason
// to treat a caller as signed out.
const tokenErrors = [
	errors.JWTClaimValidationFailed,
	errors.JWTInvalid,
	errors.JWSInvalid,
	errors.JWSSignatureVerificationFailed,
	errors.JOSEAlgNotAllowed,
	errors.JOSENotSupported,
	errors.JWKSNoMatchingKey,
	errors.JWKSMultipleMatchingKeys,
];

const authnTokenErrorIs = (error: unknown): boolean =>
	tokenErrors.some((tokenError) => error instanceof tokenError);

// `actorFromClaims` is the Project's pure mapping; a throw means the claims are not an Actor.
const authnActorFrom = (
	options: AuthnOptions,
	payload: JWTPayload,
): Actor | undefined => {
	try {
		return actorSchema.safeParse(options.actorFromClaims(payload)).data;
	} catch {
		return undefined;
	}
};

export const authnVerifyCreate =
	({
		algorithms,
		issuer,
		jwks,
		options,
	}: {
		algorithms?: readonly string[];
		issuer: string;
		jwks: JWTVerifyGetKey;
		options: AuthnOptions;
	}): AuthnState["verify"] =>
	async (accessToken) => {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(accessToken, jwks, {
				...(algorithms === undefined ? {} : { algorithms: [...algorithms] }),
				issuer,
				requiredClaims: ["exp"],
				...(options.audienceClaim === "client_id"
					? {}
					: { audience: options.audience }),
			}));
		} catch (error) {
			if (error instanceof errors.JWTExpired) return { status: "expired" };
			if (authnTokenErrorIs(error)) return { status: "invalid" };
			throw error;
		}
		if (
			options.audienceClaim === "client_id" &&
			payload["client_id"] !== options.audience
		) {
			return { status: "invalid" };
		}
		const actor = authnActorFrom(options, payload);
		if (actor === undefined) return { status: "invalid" };
		return {
			actor,
			expiresAt: (payload.exp ?? 0) * 1000,
			status: "valid",
		};
	};

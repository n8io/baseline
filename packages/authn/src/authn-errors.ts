/** No signed-in actor where a use case needs one. `httpErrorHandle` answers 401 `AuthnRequired`. */
export class AuthnRequiredError extends Error {
	readonly type = "AuthnRequired";
	readonly httpStatus = 401;
	override readonly name = "AuthnRequiredError";
}

/** A bearer token was present but is not valid. `httpErrorHandle` answers 401 `AuthnInvalid`. */
export class AuthnInvalidError extends Error {
	readonly type = "AuthnInvalid";
	readonly httpStatus = 401;
	override readonly name = "AuthnInvalidError";
}

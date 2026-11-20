/** A success `{ ok: true, value }` or a failure `{ ok: false, error }`; TypeScript narrows on `ok`. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
/** The success case of a `Result`. */
export const ok = <T>(value: T): { readonly ok: true; readonly value: T } =>
	({ ok: true, value }) as const;
/** The failure case of a `Result`. By convention `error` is an `Error` subclass with a literal `type`. */
export const err = <E>(error: E): { readonly ok: false; readonly error: E } =>
	({ ok: false, error }) as const;

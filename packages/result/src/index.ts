export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): { readonly ok: true; readonly value: T } =>
	({ ok: true, value }) as const;
export const err = <E>(error: E): { readonly ok: false; readonly error: E } =>
	({ ok: false, error }) as const;

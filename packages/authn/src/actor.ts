/** Who is performing a Use case: a signed-in user or a machine client. */
export type Actor = {
	readonly id: string;
	readonly kind: "user" | "client";
	readonly scopes: readonly string[];
};

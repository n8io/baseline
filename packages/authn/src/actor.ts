/** Who is performing a use case: a signed-in user or a machine client. */
export type Actor = { id: string; kind: "user" | "client"; scopes: string[] };

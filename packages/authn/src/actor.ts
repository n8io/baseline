/** Who is performing a Use case: a signed-in user or a machine client. */
export type Actor = { id: string; kind: "user" | "client"; scopes: string[] };

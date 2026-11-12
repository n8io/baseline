// Ports that throw once their transaction has ended. Every transaction adapter, memory or
// Postgres, wraps each port with it; on Postgres the connection's own guard alone would surface as
// Drizzle's "Failed query" and hide why.
export const transactionPortsGuard = <T extends object>(
	ports: T,
	isOpen: () => boolean,
): T =>
	Object.fromEntries(
		Object.entries(ports).map(([key, value]) => [
			key,
			typeof value === "function"
				? async (...args: unknown[]) => {
						if (!isOpen()) {
							throw new Error(
								"Transaction ports used after the transaction ended; keep every call inside the callback",
							);
						}
						return value(...args);
					}
				: value,
		]),
	) as T;

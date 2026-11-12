import type { Foo } from "../models/foo.ts";

export const FOO_STALE_DAYS = 30;

export const fooStaleBefore = (now: Date): Date =>
	new Date(now.getTime() - FOO_STALE_DAYS * 86_400_000);

// A foo nobody has changed for FOO_STALE_DAYS and that is not archived yet.
export const fooStaleIs = (foo: Foo, now: Date): boolean =>
	foo.archivedAt === null && foo.updatedAt < fooStaleBefore(now);

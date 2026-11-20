import { type Id, idFromUuid, idToUuid } from "@n8io/baseline-id";
import { customType, type PgCustomColumnBuilder } from "drizzle-orm/pg-core";

type PostgresIdColumnBuilder<P extends string> = PgCustomColumnBuilder<{
	data: Id<P>;
	dataType: "custom";
	driverParam: string;
}>;

/**
 * A `uuid` column in the database that reads and writes prefixed ids (`foo_…`) in code. Writing
 * an id of another prefix throws a TypeError.
 */
export const postgresIdColumnCreate = <P extends string>(
	prefix: P,
): ((name?: string) => PostgresIdColumnBuilder<P>) => {
	const column = customType<{ data: Id<P>; driverData: string }>({
		dataType: () => "uuid",
		fromDriver: (value) => idFromUuid(prefix, value),
		toDriver: (value) => {
			// Types already stop a `bar` id here; this catches one cast past them.
			if (!value.startsWith(`${prefix}_`)) {
				throw new TypeError(
					`postgresIdColumnCreate: value must be a ${prefix} id`,
				);
			}
			return idToUuid(value);
		},
	});
	return (name) => (name === undefined ? column() : column(name));
};

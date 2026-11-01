// Run with `tsc --noEmit`. Each @ts-expect-error line must be a type error.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { fooTable } from "../foo/spi/foo-table.ts";

type Database = Omit<NodePgDatabase, "transaction">;
declare const pgClient: PoolClient;
const full = drizzle({ client: pgClient }); // a PoolClient is accepted
const db: Database = full; // the full instance is assignable to the narrow type

void db.select().from(fooTable).where(undefined); // builder still works
void db.insert(fooTable).values({ id: "1", name: "a" });
void db.execute("select 1");
// @ts-expect-error transaction is not on the narrowed type
void db.transaction(async () => undefined);
// @ts-expect-error a positional client is no longer accepted by drizzle() in 1.0
void drizzle(pgClient);

import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { err, ok } from "../../shared/result.ts";
import { postgresClientScoped, postgresTransaction } from "../../shared/postgres-transaction.ts";
import { FooNameTakenError } from "../foo-errors.ts";
import type { FooReadRepository, FooRepository, FooTransaction } from "../ports.ts";
import { fooTable, fooTagTable } from "./foo-table.ts";

// db.transaction() is removed from the type: inside a client-bound repository it would issue a nested BEGIN.
type Database = Omit<NodePgDatabase, "transaction">;

// Drizzle wraps a driver error in DrizzleQueryError with the driver error in `cause`.
// Walk the cause chain so the code also works if a version stops wrapping.
const uniqueViolation = (error: unknown, constraint: string): boolean => {
  for (let e = error as { code?: string; constraint?: string; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (e.code === "23505" && e.constraint === constraint) return true;
  }
  return false;
};

const fooSelect = (db: Database) =>
  db
    .select({
      id: fooTable.id,
      name: fooTable.name,
      tags: sql<string[]>`coalesce(array_agg(${fooTagTable.tag} order by ${fooTagTable.tag}) filter (where ${fooTagTable.tag} is not null), '{}')`,
    })
    .from(fooTable)
    .leftJoin(fooTagTable, eq(fooTagTable.fooId, fooTable.id))
    .groupBy(fooTable.id);

const fooRead = (db: Database): FooReadRepository => ({
  async findById(id) {
    return (await fooSelect(db).where(eq(fooTable.id, id)))[0];
  },
  async findByName(name) {
    return (await fooSelect(db).where(eq(fooTable.name, name)))[0];
  },
});

const fooRepository = (db: Database): FooRepository => ({
  ...fooRead(db),
  async insert(foo) {
    try {
      await db.insert(fooTable).values({ id: foo.id, name: foo.name });
      if (foo.tags.length > 0) await db.insert(fooTagTable).values(foo.tags.map((tag) => ({ fooId: foo.id, tag })));
      return ok(foo);
    } catch (error) {
      if (uniqueViolation(error, "foo_name_unique")) return err(new FooNameTakenError(foo.name));
      throw error;
    }
  },
});

export const fooReadRepositoryPostgres = (pgPool: Pool): FooReadRepository => fooRead(drizzle({ client: pgPool }));

export const fooTransactionPostgres =
  (pgPool: Pool, options?: { timeoutMs?: number }): FooTransaction =>
  (work) =>
    postgresTransaction(
      pgPool,
      (pgClient: PoolClient, scope) => work({ fooRepository: fooRepository(drizzle({ client: postgresClientScoped(pgClient, scope) })) }),
      options,
    );

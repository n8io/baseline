// Plain pg version of the same repository, for the line-count comparison.
import type { Pool, PoolClient, QueryResult } from "pg";
import { err, ok } from "../../shared/result.ts";
import { postgresClientScoped, postgresTransaction } from "../../shared/postgres-transaction.ts";
import { FooNameTakenError } from "../foo-errors.ts";
import type { Foo } from "../models/foo.ts";
import type { FooReadRepository, FooRepository, FooTransaction } from "../ports.ts";

type Query = Pick<PoolClient, "query">["query"] | Pool["query"];
const fooSelect = `
  select f.id, f.name, coalesce(array_agg(t.tag order by t.tag) filter (where t.tag is not null), '{}') as tags
  from foo f left join foo_tag t on t.foo_id = f.id`;

const fooRead = (pgClient: { query: (text: string, values?: unknown[]) => Promise<QueryResult> }): FooReadRepository => ({
  async findById(id) {
    return (await pgClient.query(`${fooSelect} where f.id = $1 group by f.id`, [id])).rows[0] as Foo | undefined;
  },
  async findByName(name) {
    return (await pgClient.query(`${fooSelect} where f.name = $1 group by f.id`, [name])).rows[0] as Foo | undefined;
  },
});

const fooRepository = (pgClient: PoolClient): FooRepository => ({
  ...fooRead(pgClient),
  async insert(foo) {
    try {
      await pgClient.query("insert into foo (id, name) values ($1, $2)", [foo.id, foo.name]);
      if (foo.tags.length > 0) await pgClient.query("insert into foo_tag (foo_id, tag) select $1, unnest($2::text[])", [foo.id, foo.tags]);
      return ok(foo);
    } catch (error) {
      if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "foo_name_unique") return err(new FooNameTakenError(foo.name));
      throw error;
    }
  },
});

export const fooReadRepositoryPg = (pgPool: Pool): FooReadRepository => fooRead(pgPool);

export const fooTransactionPg =
  (pgPool: Pool): FooTransaction =>
  (work) =>
    postgresTransaction(pgPool, (pgClient, scope) => work({ fooRepository: fooRepository(postgresClientScoped(pgClient, scope)) }));

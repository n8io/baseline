import type { Pool, QueryResult } from "pg";
import { pgScopedQuery, pgTransaction } from "../../shared/pg-transaction.ts";
import type { Foo } from "../models/foo.ts";
import type { FooReadRepository, FooRepository, FooTransaction } from "../ports.ts";

type Query = (text: string, values?: unknown[]) => Promise<QueryResult>;

const fooSelect = `
  select f.id, f.name, coalesce(array_agg(t.tag order by t.tag) filter (where t.tag is not null), '{}') as tags
  from foo f left join foo_tag t on t.foo_id = f.id`;

const fooRead = (query: Query): FooReadRepository => ({
  async findById(id) {
    const { rows } = await query(`${fooSelect} where f.id = $1 group by f.id`, [id]);
    return rows[0] as Foo | undefined;
  },
  async findByName(name) {
    const { rows } = await query(`${fooSelect} where f.name = $1 group by f.id`, [name]);
    return rows[0] as Foo | undefined;
  },
});

const fooRepository = (query: Query): FooRepository => ({
  ...fooRead(query),
  async insert(foo) {
    await query("insert into foo (id, name) values ($1, $2)", [foo.id, foo.name]);
    if (foo.tags.length > 0) {
      await query("insert into foo_tag (foo_id, tag) select $1, unnest($2::text[])", [foo.id, foo.tags]);
    }
    return foo;
  },
});

export const fooReadRepositoryPostgres = (pgPool: Pool): FooReadRepository =>
  fooRead((text, values) => pgPool.query(text, values));

export const fooTransactionPostgres =
  (pgPool: Pool): FooTransaction =>
  (work) =>
    pgTransaction(pgPool, (client, scope) => work({ fooRepository: fooRepository(pgScopedQuery(client, scope)) }));

// Option 5 for comparison: one call saves the whole aggregate, atomic inside the adapter.
export const fooRepositoryAggregatePostgres = (pgPool: Pool) => ({
  ...fooReadRepositoryPostgres(pgPool),
  insert: async (foo: Foo) => {
    const result = await pgTransaction(pgPool, async (client, scope) => {
      const value = await fooRepository(pgScopedQuery(client, scope)).insert(foo);
      return { ok: true as const, value };
    });
    return result.value;
  },
});

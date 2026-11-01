import { readFileSync } from "node:fs";
import pg from "pg";

export const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:pg@127.0.0.1:55433/postgres";
const schema = readFileSync(new URL("../foo/spi/foo-schema.sql", import.meta.url), "utf8");
export const pgPoolCreate = (options: pg.PoolConfig = {}) => new pg.Pool({ connectionString: databaseUrl, ...options });
export const schemaReset = async (pgPool: pg.Pool) => {
  await pgPool.query("drop table if exists foo_tag; drop table if exists foo;");
  await pgPool.query(schema);
};
export const fooCount = async (pgPool: pg.Pool, name?: string) => {
  const { rows } = name
    ? await pgPool.query("select count(*)::int as n from foo where name = $1", [name])
    : await pgPool.query("select count(*)::int as n from foo");
  return rows[0].n as number;
};
export const tagCount = async (pgPool: pg.Pool) => (await pgPool.query("select count(*)::int as n from foo_tag")).rows[0].n as number;

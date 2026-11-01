import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
const admin = new pg.Client({ connectionString: "postgres://postgres:postgres@127.0.0.1:55432/postgres" });
await admin.connect();
export const url = (db: string) => `postgres://postgres:postgres@127.0.0.1:55432/${db}`;
export async function fresh(name: string) { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${name}`); }
export async function mig(db: string, folder = "./drizzle", extra: object = {}) {
  const pool = new pg.Pool({ connectionString: url(db), max: 4 });
  try { await migrate(drizzle({ client: pool }), { migrationsFolder: folder, ...extra }); return "ok"; }
  catch (e: any) { return `ERR ${e.cause?.message ?? e.message}`; } finally { await pool.end(); }
}
export { admin, pg };

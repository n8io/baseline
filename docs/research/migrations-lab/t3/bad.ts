import { admin, fresh, mig, url, pg } from "./run.ts";
await fresh("mig_bad");
console.log(await mig("mig_bad", "./bad"));
const c = new pg.Client({ connectionString: url("mig_bad") }); await c.connect();
console.log("bookkeeping rows:", (await c.query("select count(*) from drizzle.__drizzle_migrations")).rows[0].count, "public tables:", (await c.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count);
await c.end(); await admin.end();

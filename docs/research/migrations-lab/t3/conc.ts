import { admin, fresh, mig, url, pg } from "./run.ts";
for (let round = 1; round <= 5; round++) {
  await fresh("mig_conc");
  const r = await Promise.all([mig("mig_conc"), mig("mig_conc")]);
  const c = new pg.Client({ connectionString: url("mig_conc") }); await c.connect();
  const rows = (await c.query("select id,name from drizzle.__drizzle_migrations order by id")).rows.length;
  const tabs = (await c.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count;
  await c.end();
  console.log(`round ${round}:`, r, `bookkeeping rows=${rows} public tables=${tabs}`);
}
await admin.end();

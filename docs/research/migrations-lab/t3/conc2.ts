import { admin, fresh, mig, url, pg } from "./run.ts";
for (let round = 1; round <= 3; round++) {
  await fresh("mig_conc2");
  console.log("pre-apply t1:", await mig("mig_conc2", "./first"));
  const r = await Promise.all([mig("mig_conc2"), mig("mig_conc2")]);
  const c = new pg.Client({ connectionString: url("mig_conc2") }); await c.connect();
  const rows = (await c.query("select count(*) from drizzle.__drizzle_migrations")).rows[0].count;
  await c.end();
  console.log(`round ${round}:`, r, `rows=${rows}`);
}
await admin.end();

import { admin, fresh, mig, url, pg } from "./run.ts";
import { cpSync, readdirSync, rmSync } from "node:fs";
await fresh("mig_ooo");
console.log("apply t1,t3,t4,t5:", await mig("mig_ooo", "./ooo"));
cpSync("./drizzle/20261101162109_add_t2", "./ooo/20261101162109_add_t2", { recursive: true });
console.log("folders:", readdirSync("./ooo").join(", "));
console.log("then add older t2 and migrate:", await mig("mig_ooo", "./ooo"));
const c = new pg.Client({ connectionString: url("mig_ooo") }); await c.connect();
console.log((await c.query("select id,name,created_at,hash from drizzle.__drizzle_migrations order by id")).rows.map(r=>`${r.id} ${r.name} ${r.created_at}`));
console.log("tables:", (await c.query("select table_name from information_schema.tables where table_schema='public' order by 1")).rows.map(r=>r.table_name).join());
// local folder deleted but applied in db
rmSync("./ooo/20261101162107_add_t1", { recursive: true });
console.log("after deleting applied t1 locally:", await mig("mig_ooo", "./ooo"));
// custom table/schema config
await fresh("mig_cfg");
console.log("custom:", await mig("mig_cfg", "./drizzle", { migrationsSchema: "ops", migrationsTable: "my_migs" }));
const d = new pg.Client({ connectionString: url("mig_cfg") }); await d.connect();
console.log((await d.query("select table_schema,table_name from information_schema.tables where table_name like '%migs%' or table_name like '%drizzle%'")).rows);
console.log((await d.query("select column_name,data_type from information_schema.columns where table_name='my_migs' order by ordinal_position")).rows.map(r=>r.column_name+":"+r.data_type).join());
await c.end(); await d.end(); await admin.end();

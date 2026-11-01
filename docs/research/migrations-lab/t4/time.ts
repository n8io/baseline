import { admin, fresh, mig, url, pg } from "./run.ts";
const ms = (t: number) => (performance.now() - t).toFixed(0) + "ms";
const q = async (sql: string) => { const t = performance.now(); await admin.query(sql); return performance.now() - t; };
const stat = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `min ${s[0].toFixed(0)} median ${s[s.length >> 1].toFixed(0)} max ${s.at(-1)!.toFixed(0)} ms (n=${xs.length})`; };
const N = 10;
const create: number[] = [], migT: number[] = [], total: number[] = [], tpl: number[] = [], drop: number[] = [], mig2: number[] = [];
for (let i = 0; i < N; i++) {
  await admin.query("DROP DATABASE IF EXISTS tm WITH (FORCE)");
  const t0 = performance.now(); await admin.query("CREATE DATABASE tm"); const c = performance.now() - t0; create.push(c);
  const t1 = performance.now(); const r = await mig("tm"); const m = performance.now() - t1; migT.push(m); total.push(c + m);
  if (r !== "ok") throw new Error(r);
  // idempotent re-run (nothing pending)
  const t2 = performance.now(); await mig("tm"); mig2.push(performance.now() - t2);
}
console.log("CREATE DATABASE (empty, template1):", stat(create));
console.log("migrate() 5 migrations on empty db (incl. new Pool + connect):", stat(migT));
console.log("create+migrate total:", stat(total));
console.log("migrate() again, nothing pending:", stat(mig2));
// template: tm is migrated. connections to tm must be closed (they are).
for (let i = 0; i < N; i++) {
  await admin.query("DROP DATABASE IF EXISTS tm_copy WITH (FORCE)");
  tpl.push(await q("CREATE DATABASE tm_copy TEMPLATE tm"));
}
console.log("CREATE DATABASE ... TEMPLATE migrated:", stat(tpl));
const t = performance.now(); await admin.query("DROP DATABASE tm_copy WITH (FORCE)"); console.log("DROP DATABASE:", ms(t));
await admin.query("DROP DATABASE tm WITH (FORCE)");
await admin.end();

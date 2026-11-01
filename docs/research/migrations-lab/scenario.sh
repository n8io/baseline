#!/bin/bash
# usage: scenario.sh name 'A-content-of-a.ts' 'B-content-of-a.ts' [base-content]
set -u
export PATH=~/.nvm/versions/node/v26.5.0/bin:$PATH
n=$1; A=$2; B=$3
base=${4:-'import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const a = pgTable("a", { id: uuid().primaryKey(), name: text().notNull(), other: text() });'}
root=/Users/n8/code/n8io/baseline-migrations/docs/research/migrations-lab
rm -rf $root/s_$n; mkdir -p $root/s_$n/src; cd $root/s_$n; ln -s ../node_modules node_modules
cat > drizzle.config.ts <<'X'
import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/*.ts", out: "./drizzle" });
X
g="git -c user.email=x@x -c user.name=x"
git init -q -b main .; echo node_modules > .gitignore
echo "$base" > src/a.ts; npx drizzle-kit generate --name base >/dev/null 2>&1; git add -A; $g commit -qm base
git checkout -qb A; echo "$A" > src/a.ts; sleep 1; npx drizzle-kit generate --name a_change 2>&1 | tail -1; git add -A; $g commit -qm A
git checkout -q main; git checkout -qb B; echo "$B" > src/a.ts; sleep 1; npx drizzle-kit generate --name b_change 2>&1 | tail -1; git add -A; $g commit -qm B
echo "--- git merge"; $g merge A -m merge 2>&1 | tail -3
if [ -n "${5:-}" ]; then echo "$5" > src/a.ts; fi; echo "--- src/a.ts after merge:"; cat src/a.ts
for d in drizzle/*/; do echo "== $d"; cat $d/migration.sql; echo; done
echo "--- check"; npx drizzle-kit check --output json; echo " exit=$?"
echo "--- generate --explain"; npx drizzle-kit generate --explain --output json; echo " exit=$?"

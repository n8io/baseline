import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/*.ts", out: "./drizzle", dbCredentials: { url: "postgres://postgres:postgres@127.0.0.1:55432/" + (process.env.DB ?? "kitm") }, migrations: { schema: "ops", table: "migs" } });

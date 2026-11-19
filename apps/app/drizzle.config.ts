import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	out: "./migrations",
	schema: "./src/contexts/*/adapters/outbound/*-table.ts",
});

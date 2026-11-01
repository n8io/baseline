import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/domains/*/spi/*-table.ts",
  out: "./drizzle",
});

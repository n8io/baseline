CREATE SCHEMA "foo";
--> statement-breakpoint
CREATE TABLE "foo"."foo" ("id" uuid PRIMARY KEY, "name" text NOT NULL);
--> statement-breakpoint
SELECT pg_sleep(1);

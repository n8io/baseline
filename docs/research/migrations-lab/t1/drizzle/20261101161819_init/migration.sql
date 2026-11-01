CREATE SCHEMA "bar";
--> statement-breakpoint
CREATE SCHEMA "foo";
--> statement-breakpoint
CREATE TABLE "bar"."bar" (
	"id" uuid PRIMARY KEY,
	"foo_id" uuid,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "foo"."foo" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bar"."bar" ADD CONSTRAINT "bar_foo_id_foo_id_fkey" FOREIGN KEY ("foo_id") REFERENCES "foo"."foo"("id");
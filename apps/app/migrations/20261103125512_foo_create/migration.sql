CREATE SCHEMA "foo";
--> statement-breakpoint
CREATE TABLE "foo"."foo" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "foo_name_key" ON "foo"."foo" ("name");--> statement-breakpoint
CREATE INDEX "foo_created_at_idx" ON "foo"."foo" ("created_at");--> statement-breakpoint
CREATE INDEX "foo_updated_at_idx" ON "foo"."foo" ("updated_at");
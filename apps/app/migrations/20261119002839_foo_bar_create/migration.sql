CREATE TABLE "foo"."bar" (
	"id" uuid PRIMARY KEY,
	"foo_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bar_foo_id_created_at_idx" ON "foo"."bar" ("foo_id","created_at");
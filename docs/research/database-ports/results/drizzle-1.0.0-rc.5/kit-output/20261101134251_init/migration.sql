CREATE TABLE "bar" (
	"id" uuid PRIMARY KEY,
	"foo_id" uuid,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foo" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foo_tag" (
	"foo_id" uuid,
	"tag" text,
	CONSTRAINT "foo_tag_pkey" PRIMARY KEY("foo_id","tag")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "foo_name_unique" ON "foo" ("name");--> statement-breakpoint
ALTER TABLE "bar" ADD CONSTRAINT "bar_foo_id_foo_id_fkey" FOREIGN KEY ("foo_id") REFERENCES "foo"("id");--> statement-breakpoint
ALTER TABLE "foo_tag" ADD CONSTRAINT "foo_tag_foo_id_foo_id_fkey" FOREIGN KEY ("foo_id") REFERENCES "foo"("id");
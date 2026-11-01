CREATE TABLE "t4" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "t4_name_idx" ON "t4" ("name");
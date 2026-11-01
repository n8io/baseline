CREATE TABLE "t5" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "t5_name_idx" ON "t5" ("name");
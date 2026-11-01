CREATE TABLE "t3" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "t3_name_idx" ON "t3" ("name");
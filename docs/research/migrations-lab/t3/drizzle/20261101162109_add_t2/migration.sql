CREATE TABLE "t2" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "t2_name_idx" ON "t2" ("name");
CREATE TABLE "t1" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "t1_name_idx" ON "t1" ("name");
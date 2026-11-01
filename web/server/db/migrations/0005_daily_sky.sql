CREATE TABLE "sky_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"local_date" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"forecast" jsonb NOT NULL,
	"script" text,
	"job" text,
	"file_id" text,
	"error" text,
	"prompt_version" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sky_readings_date_timezone" ON "sky_readings" USING btree ("local_date","timezone");
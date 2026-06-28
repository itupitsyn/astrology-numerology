CREATE TABLE "reading_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"reading_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text,
	"full_name" text,
	"city" text,
	"birth_year" integer NOT NULL,
	"birth_month" integer NOT NULL,
	"birth_day" integer NOT NULL,
	"birth_hour" integer NOT NULL,
	"birth_minute" integer NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"timezone" text,
	"target_year" integer,
	"focus" text,
	"chart" jsonb NOT NULL,
	"numerology" jsonb NOT NULL,
	"interpretation" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"usage" jsonb
);
--> statement-breakpoint
ALTER TABLE "reading_feedback" ADD CONSTRAINT "reading_feedback_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;
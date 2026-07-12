CREATE TABLE "horary_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"horary_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horary_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"category" text,
	"quesited_house" integer NOT NULL,
	"querent_house" integer NOT NULL,
	"city" text,
	"moment_utc" text,
	"moment_local" text,
	"timezone" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"verdict" text NOT NULL,
	"perfection_mode" text,
	"horary" jsonb NOT NULL,
	"interpretation" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"usage" jsonb
);
--> statement-breakpoint
ALTER TABLE "horary_feedback" ADD CONSTRAINT "horary_feedback_horary_id_horary_readings_id_fk" FOREIGN KEY ("horary_id") REFERENCES "public"."horary_readings"("id") ON DELETE cascade ON UPDATE no action;
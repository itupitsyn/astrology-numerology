CREATE TABLE "daily_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"daily_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"local_date" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"profile_version" text NOT NULL,
	"forecast" jsonb,
	"numerology" jsonb,
	"interpretation" text,
	"error" text,
	"model" text,
	"prompt_version" text,
	"usage" jsonb
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"name" text,
	"full_name" text,
	"birth_year" integer NOT NULL,
	"birth_month" integer NOT NULL,
	"birth_day" integer NOT NULL,
	"birth_hour" integer NOT NULL,
	"birth_minute" integer NOT NULL,
	"birth_latitude" double precision NOT NULL,
	"birth_longitude" double precision NOT NULL,
	"birth_timezone" text,
	"birth_city" text,
	"place_latitude" double precision,
	"place_longitude" double precision,
	"place_timezone" text,
	"place_city" text,
	"version" text NOT NULL,
	CONSTRAINT "profiles_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "daily_feedback" ADD CONSTRAINT "daily_feedback_daily_id_daily_readings_id_fk" FOREIGN KEY ("daily_id") REFERENCES "public"."daily_readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD CONSTRAINT "daily_readings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_readings_profile_date" ON "daily_readings" USING btree ("profile_id","local_date");
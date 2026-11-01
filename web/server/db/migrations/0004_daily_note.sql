ALTER TABLE "daily_readings" ADD COLUMN "note_status" text;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD COLUMN "note_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD COLUMN "note_script" text;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD COLUMN "note_job" text;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD COLUMN "note_file_id" text;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD COLUMN "note_error" text;
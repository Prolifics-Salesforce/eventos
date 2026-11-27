ALTER TABLE "event" ADD COLUMN "host_name" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "confirmation_note" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "feedback_email" boolean DEFAULT false NOT NULL;
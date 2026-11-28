ALTER TABLE "event" ADD COLUMN "online_url" text;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "vip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "referred_by" uuid;
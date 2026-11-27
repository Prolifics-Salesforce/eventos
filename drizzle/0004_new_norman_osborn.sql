ALTER TABLE "event" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "location_url" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "require_approval" boolean DEFAULT false NOT NULL;
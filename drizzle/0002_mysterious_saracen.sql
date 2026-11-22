CREATE TABLE "form_field" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_property" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_field" ADD CONSTRAINT "form_field_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_field_key" ON "form_field" USING btree ("event_id","purpose","key");
CREATE TABLE "budget_item" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"planned" integer DEFAULT 0 NOT NULL,
	"actual" integer
);
--> statement-breakpoint
CREATE TABLE "survey_response" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	CONSTRAINT "survey_response_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "target_registrations" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "target_leads" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "pipeline_value" integer;--> statement-breakpoint
ALTER TABLE "budget_item" ADD CONSTRAINT "budget_item_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_item_event" ON "budget_item" USING btree ("event_id");
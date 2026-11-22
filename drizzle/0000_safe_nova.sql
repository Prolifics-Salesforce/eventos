CREATE TABLE "account" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	CONSTRAINT "account_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text NOT NULL,
	"phone" text,
	"title" text,
	"account_id" uuid,
	"email_opt_out_at" timestamp with time zone,
	"whatsapp_opt_in_at" timestamp with time zone,
	CONSTRAINT "contact_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"venue" text,
	"brief" text,
	CONSTRAINT "event_number_unique" UNIQUE("number"),
	CONSTRAINT "event_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_session" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"abstract" text,
	"track" text,
	"room" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"capacity" integer
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"number" text NOT NULL,
	"event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"captured_by" uuid,
	"notes" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"band" text,
	CONSTRAINT "lead_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "registration" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"number" text NOT NULL,
	"event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"source" text,
	"pin" text,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" uuid,
	CONSTRAINT "registration_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "session_speaker" (
	"session_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text DEFAULT 'speaker' NOT NULL,
	CONSTRAINT "session_speaker_session_id_contact_id_pk" PRIMARY KEY("session_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "sys_api_key" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_api_key_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "sys_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"approved_by" uuid,
	"tool" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"error" text,
	"run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sys_dictionary" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'string' NOT NULL,
	"choices" jsonb,
	"is_custom" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "sys_journal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" text DEFAULT 'work_note' NOT NULL,
	"body" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_number" (
	"prefix" text PRIMARY KEY NOT NULL,
	"next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_outbox" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact_id" uuid,
	"event_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	CONSTRAINT "sys_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "sys_policy" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tool" text DEFAULT '*' NOT NULL,
	"level" text NOT NULL,
	"daily_cap" integer
);
--> statement-breakpoint
CREATE TABLE "sys_role" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "sys_role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sys_user" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sys_user_role" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "sys_user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_created_by" uuid,
	"sys_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sys_updated_by" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"number" text NOT NULL,
	"task_type" text DEFAULT 'task' NOT NULL,
	"short_description" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"assigned_to" uuid,
	"event_id" uuid,
	"parent_id" uuid,
	"due_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "task_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_account_id_account_sys_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("sys_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_session" ADD CONSTRAINT "event_session_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_contact_id_contact_sys_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_contact_id_contact_sys_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speaker" ADD CONSTRAINT "session_speaker_session_id_event_session_sys_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_session"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speaker" ADD CONSTRAINT "session_speaker_contact_id_contact_sys_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_api_key" ADD CONSTRAINT "sys_api_key_user_id_sys_user_sys_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sys_user"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_policy" ADD CONSTRAINT "sys_policy_user_id_sys_user_sys_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sys_user"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_user_id_sys_user_sys_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sys_user"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_role_id_sys_role_sys_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_role"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_event_id_event_sys_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("sys_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_session_event" ON "event_session" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "lead_event" ON "lead" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_once" ON "registration" USING btree ("event_id","contact_id");--> statement-breakpoint
CREATE INDEX "sys_audit_actor" ON "sys_audit" USING btree ("actor_id","tool","at");--> statement-breakpoint
CREATE UNIQUE INDEX "sys_dictionary_field" ON "sys_dictionary" USING btree ("table_name","column_name");--> statement-breakpoint
CREATE INDEX "sys_event_pending" ON "sys_event" USING btree ("id") WHERE "sys_event"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "sys_journal_record" ON "sys_journal" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "sys_outbox_due" ON "sys_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "sys_policy_lookup" ON "sys_policy" USING btree ("user_id","tool");--> statement-breakpoint
CREATE INDEX "task_inbox" ON "task" USING btree ("task_type","state");--> statement-breakpoint
CREATE INDEX "task_event" ON "task" USING btree ("event_id");
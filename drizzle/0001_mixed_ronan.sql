CREATE TABLE "sys_session" (
	"sys_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sys_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "sys_user" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "sys_session" ADD CONSTRAINT "sys_session_user_id_sys_user_sys_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sys_user"("sys_id") ON DELETE cascade ON UPDATE no action;
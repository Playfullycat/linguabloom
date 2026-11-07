CREATE TABLE "ai_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word" text NOT NULL,
	"context_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_definitions_word_context_unique" UNIQUE("word","context_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_ref" text,
	"request" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"result_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "ai_generations_status_check" CHECK ("ai_generations"."status" in ('draft','published','discarded'))
);
--> statement-breakpoint
CREATE TABLE "writing_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt_id" text,
	"task_type" text NOT NULL,
	"task" jsonb NOT NULL,
	"level" text NOT NULL,
	"original_text" text NOT NULL,
	"feedback" jsonb,
	"revised_text" text,
	"revision_feedback" jsonb,
	"rubric_version" text NOT NULL,
	"confidence" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_at" timestamp with time zone,
	CONSTRAINT "writing_submissions_status_check" CHECK ("writing_submissions"."status" in ('draft','feedback','revised'))
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "generation_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_generations_user_idx" ON "ai_generations" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "writing_submissions_user_idx" ON "writing_submissions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
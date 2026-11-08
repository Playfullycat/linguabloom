CREATE TABLE "speaking_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"prompt_id" text NOT NULL,
	"mode" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"save_transcript" boolean NOT NULL,
	"save_audio" boolean NOT NULL,
	"level" text NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"learner_turns" integer DEFAULT 0 NOT NULL,
	"learner_words" integer DEFAULT 0 NOT NULL,
	"audio_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evaluation" jsonb,
	"confidence" text,
	"duration_seconds" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"connect_count" integer DEFAULT 0 NOT NULL,
	"credential_expires_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "speaking_attempts_status_check" CHECK ("speaking_attempts"."status" in ('active','ended')),
	CONSTRAINT "speaking_attempts_mode_check" CHECK ("speaking_attempts"."mode" in ('realtime','standard','typed'))
);
--> statement-breakpoint
ALTER TABLE "study_preferences" ADD COLUMN "save_speaking_audio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "study_preferences" ADD COLUMN "save_speaking_transcripts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaking_attempts_user_idx" ON "speaking_attempts" USING btree ("user_id","created_at");
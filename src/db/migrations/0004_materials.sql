CREATE TABLE "content_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_id" text NOT NULL,
	"kind" text NOT NULL,
	"segment_seq" smallint,
	"payload" jsonb,
	"is_correct" boolean,
	"duration_ms" integer,
	"client_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_interactions_client_request_id_unique" UNIQUE("client_request_id")
);
--> statement-breakpoint
CREATE TABLE "learning_contents" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title_en" text NOT NULL,
	"title_zh" text NOT NULL,
	"summary_zh" text NOT NULL,
	"cefr_level" text NOT NULL,
	"topic" text,
	"difficulty_metadata" jsonb NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"copyright_status" text NOT NULL,
	"review_status" text NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" uuid,
	"duration_seconds" integer,
	"media_asset_id" text,
	"content" jsonb NOT NULL,
	"content_version" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_contents_type_check" CHECK ("learning_contents"."type" in ('reading','listening')),
	CONSTRAINT "learning_contents_status_check" CHECK ("learning_contents"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" text NOT NULL,
	"sequence" smallint NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"speaker" text,
	"text_en" text NOT NULL,
	"text_zh" text,
	"metadata" jsonb,
	CONSTRAINT "transcript_segments_content_seq_unique" UNIQUE("content_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "user_content_state" (
	"user_id" uuid NOT NULL,
	"content_id" text NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"note" text,
	"saved_segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_content_state_user_id_content_id_pk" PRIMARY KEY("user_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_interactions" ADD CONSTRAINT "content_interactions_content_id_learning_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."learning_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_contents" ADD CONSTRAINT "learning_contents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_content_id_learning_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."learning_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_content_state" ADD CONSTRAINT "user_content_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_content_state" ADD CONSTRAINT "user_content_state_content_id_learning_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."learning_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_interactions_user_content_idx" ON "content_interactions" USING btree ("user_id","content_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_contents_type_level_idx" ON "learning_contents" USING btree ("type","cefr_level");
CREATE TABLE "exam_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam" text NOT NULL,
	"label_zh" text NOT NULL,
	"effective_from" date,
	"reviewed_on" date NOT NULL,
	"sources" jsonb NOT NULL,
	"notes_zh" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pte_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exam_version_id" text NOT NULL,
	"task_code" text NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"mode" text NOT NULL,
	"response" jsonb NOT NULL,
	"score" real,
	"max_score" real,
	"score_detail" jsonb,
	"feedback" jsonb,
	"snapshot" jsonb NOT NULL,
	"duration_ms" integer,
	"time_limit_seconds" integer,
	"timed_out" boolean DEFAULT false NOT NULL,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pte_attempts_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "pte_attempts_mode_check" CHECK ("pte_attempts"."mode" in ('practice','timed','mock'))
);
--> statement-breakpoint
CREATE TABLE "pte_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"task_code" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"title_zh" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"review_status" text NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pte_rubrics" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_version_id" text NOT NULL,
	"task_code" text NOT NULL,
	"rubric_version" text NOT NULL,
	"traits" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pte_task_types" (
	"exam_version_id" text NOT NULL,
	"code" text NOT NULL,
	"section" text NOT NULL,
	"sort_order" smallint NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text NOT NULL,
	"skills" jsonb NOT NULL,
	"timing" jsonb NOT NULL,
	"scoring" jsonb NOT NULL,
	"description_zh" text NOT NULL,
	"tips_zh" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"practice_available" boolean NOT NULL,
	CONSTRAINT "pte_task_types_exam_version_id_code_pk" PRIMARY KEY("exam_version_id","code"),
	CONSTRAINT "pte_task_types_section_check" CHECK ("pte_task_types"."section" in ('speaking_writing','reading','listening'))
);
--> statement-breakpoint
ALTER TABLE "pte_attempts" ADD CONSTRAINT "pte_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pte_attempts" ADD CONSTRAINT "pte_attempts_exam_version_id_exam_versions_id_fk" FOREIGN KEY ("exam_version_id") REFERENCES "public"."exam_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pte_attempts" ADD CONSTRAINT "pte_attempts_prompt_id_pte_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."pte_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pte_rubrics" ADD CONSTRAINT "pte_rubrics_exam_version_id_exam_versions_id_fk" FOREIGN KEY ("exam_version_id") REFERENCES "public"."exam_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pte_task_types" ADD CONSTRAINT "pte_task_types_exam_version_id_exam_versions_id_fk" FOREIGN KEY ("exam_version_id") REFERENCES "public"."exam_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pte_attempts_user_idx" ON "pte_attempts" USING btree ("user_id","task_code","created_at");--> statement-breakpoint
CREATE INDEX "pte_prompts_task_idx" ON "pte_prompts" USING btree ("task_code");--> statement-breakpoint
CREATE INDEX "pte_rubrics_task_idx" ON "pte_rubrics" USING btree ("exam_version_id","task_code");
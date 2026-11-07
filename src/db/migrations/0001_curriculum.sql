CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"title_en" text NOT NULL,
	"title_zh" text NOT NULL,
	"summary_zh" text NOT NULL,
	"source_type" text NOT NULL,
	"content_schema_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_lesson_progress" (
	"user_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"status" text NOT NULL,
	"current_step_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_ratio" real DEFAULT 0 NOT NULL,
	"mastery_estimate" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_lesson_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id"),
	CONSTRAINT "learner_lesson_progress_status_check" CHECK ("learner_lesson_progress"."status" in ('in_progress','completed'))
);
--> statement-breakpoint
CREATE TABLE "lesson_step_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"step_key" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"response" jsonb NOT NULL,
	"is_correct" boolean,
	"self_score" real,
	"duration_ms" integer,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_step_attempts_client_request_id_unique" UNIQUE("client_request_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"step_key" text NOT NULL,
	"sort_order" smallint NOT NULL,
	"step_type" text NOT NULL,
	"role" text NOT NULL,
	"skill" text NOT NULL,
	"assessed" boolean NOT NULL,
	"content" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_id" text NOT NULL,
	"sort_order" smallint NOT NULL,
	"kind" text NOT NULL,
	"title_en" text NOT NULL,
	"title_zh" text NOT NULL,
	"estimated_minutes" smallint NOT NULL,
	"objectives" jsonb NOT NULL,
	"can_do_ids" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_kind_check" CHECK ("lessons"."kind" in ('core','review'))
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"level" text NOT NULL,
	"sort_order" smallint NOT NULL,
	"title_en" text NOT NULL,
	"title_zh" text NOT NULL,
	"summary_zh" text NOT NULL,
	"status" text NOT NULL,
	"review_status" text NOT NULL,
	"source_type" text NOT NULL,
	"content" jsonb,
	"content_schema_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_course_level_order_unique" UNIQUE("course_id","level","sort_order"),
	CONSTRAINT "units_status_check" CHECK ("units"."status" in ('planned','draft','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "learner_lesson_progress" ADD CONSTRAINT "learner_lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_lesson_progress" ADD CONSTRAINT "learner_lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_step_attempts" ADD CONSTRAINT "lesson_step_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_step_attempts" ADD CONSTRAINT "lesson_step_attempts_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_steps" ADD CONSTRAINT "lesson_steps_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_level_cefr_levels_code_fk" FOREIGN KEY ("level") REFERENCES "public"."cefr_levels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_step_attempts_user_lesson_idx" ON "lesson_step_attempts" USING btree ("user_id","lesson_id","step_key");--> statement-breakpoint
CREATE INDEX "lesson_steps_lesson_id_idx" ON "lesson_steps" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "lessons_unit_id_idx" ON "lessons" USING btree ("unit_id");
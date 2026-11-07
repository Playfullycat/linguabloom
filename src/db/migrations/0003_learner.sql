CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"skill" text NOT NULL,
	"cefr_level" text NOT NULL,
	"response" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_attempts_session_item_unique" UNIQUE("session_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_items" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_version" text NOT NULL,
	"skill" text NOT NULL,
	"subskill" text,
	"cefr_level" text NOT NULL,
	"difficulty" real NOT NULL,
	"discrimination" real NOT NULL,
	"content" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_version" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"self_reported_level" text,
	"skipped_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"writing_sample" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"native_language" text DEFAULT 'zh-CN' NOT NULL,
	"explanation_language" text DEFAULT 'zh' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"self_reported_level" text,
	"learning_goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"onboarding_step" text DEFAULT 'welcome' NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"profile_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"estimated_level" text NOT NULL,
	"confidence" text NOT NULL,
	"evidence_count" integer NOT NULL,
	"source" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plan_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"href" text NOT NULL,
	"minutes" smallint NOT NULL,
	"reason" text NOT NULL,
	"target_id" text,
	"sort_order" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"session_minutes" smallint NOT NULL,
	"mode" text DEFAULT 'normal' NOT NULL,
	"comeback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_plans_user_date_unique" UNIQUE("user_id","plan_date")
);
--> statement-breakpoint
CREATE TABLE "study_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_minutes" smallint DEFAULT 25 NOT NULL,
	"weekly_days" smallint DEFAULT 5 NOT NULL,
	"new_items_limit" smallint DEFAULT 20 NOT NULL,
	"review_limit" smallint DEFAULT 200 NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	"show_weekly_streak" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_preferences_minutes_check" CHECK ("study_preferences"."daily_minutes" in (15, 25, 40, 60)),
	CONSTRAINT "study_preferences_days_check" CHECK ("study_preferences"."weekly_days" between 1 and 7),
	CONSTRAINT "study_preferences_new_items_check" CHECK ("study_preferences"."new_items_limit" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_session_id_assessment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assessment_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_item_id_assessment_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."assessment_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_estimates" ADD CONSTRAINT "skill_estimates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_tasks" ADD CONSTRAINT "study_plan_tasks_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_preferences" ADD CONSTRAINT "study_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_sessions_user_idx" ON "assessment_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "skill_estimates_user_skill_idx" ON "skill_estimates" USING btree ("user_id","skill","created_at");--> statement-breakpoint
CREATE INDEX "study_plan_tasks_plan_idx" ON "study_plan_tasks" USING btree ("plan_id","sort_order");
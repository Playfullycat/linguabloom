CREATE TABLE "error_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"point_type" text NOT NULL,
	"point_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_wrong" text,
	"last_correct" text,
	"remediation_passed_at" timestamp with time zone,
	"retest_due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"recurred_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "error_items_user_point_unique" UNIQUE("user_id","category","point_type","point_id"),
	CONSTRAINT "error_items_status_check" CHECK ("error_items"."status" in ('active','retest','resolved'))
);
--> statement-breakpoint
CREATE TABLE "error_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"error_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"wrong" text,
	"correct" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"score" real NOT NULL,
	"is_correct" boolean,
	"feedback" jsonb,
	"context" text NOT NULL,
	"error_item_id" uuid,
	"duration_ms" integer,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_attempts_client_request_id_unique" UNIQUE("client_request_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"grammar_point_id" text,
	"exercise_type" text NOT NULL,
	"skill" text NOT NULL,
	"cefr_level" text NOT NULL,
	"difficulty" real NOT NULL,
	"prompt" jsonb NOT NULL,
	"answer_key" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"error_category" text NOT NULL,
	"scoring_rule" text NOT NULL,
	"sort_order" smallint NOT NULL,
	"content_version" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grammar_points" (
	"id" text PRIMARY KEY NOT NULL,
	"sort_order" smallint NOT NULL,
	"level" text NOT NULL,
	"title_en" text NOT NULL,
	"title_zh" text NOT NULL,
	"status" text NOT NULL,
	"topics" jsonb NOT NULL,
	"prerequisite_ids" jsonb NOT NULL,
	"unit_grammar_ids" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"default_error_category" text NOT NULL,
	"source_reference" text,
	"review_status" text NOT NULL,
	"content_version" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grammar_points_sort_order_unique" UNIQUE("sort_order")
);
--> statement-breakpoint
ALTER TABLE "error_items" ADD CONSTRAINT "error_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_occurrences" ADD CONSTRAINT "error_occurrences_error_item_id_error_items_id_fk" FOREIGN KEY ("error_item_id") REFERENCES "public"."error_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_occurrences" ADD CONSTRAINT "error_occurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_grammar_point_id_grammar_points_id_fk" FOREIGN KEY ("grammar_point_id") REFERENCES "public"."grammar_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_items_user_status_idx" ON "error_items" USING btree ("user_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "error_occurrences_item_idx" ON "error_occurrences" USING btree ("error_item_id","created_at");--> statement-breakpoint
CREATE INDEX "exercise_attempts_user_idx" ON "exercise_attempts" USING btree ("user_id","exercise_id","created_at");--> statement-breakpoint
CREATE INDEX "exercises_point_idx" ON "exercises" USING btree ("grammar_point_id","sort_order");
CREATE TABLE "review_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"card_type" text NOT NULL,
	"fsrs_state" jsonb NOT NULL,
	"scheduler_version" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" smallint NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"stability" real DEFAULT 0 NOT NULL,
	"suspended_at" timestamp with time zone,
	"difficult_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_cards_user_entry_type_unique" UNIQUE("user_id","entry_id","card_type"),
	CONSTRAINT "review_cards_type_check" CHECK ("review_cards"."card_type" in ('recognition','listening','recall','spelling','cloze'))
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"elapsed_ms" integer,
	"response_mode" text NOT NULL,
	"answer_correct" boolean,
	"hint_used" boolean DEFAULT false NOT NULL,
	"user_answer" jsonb,
	"state_before" jsonb NOT NULL,
	"scheduler_result" jsonb NOT NULL,
	"algorithm_version" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	CONSTRAINT "review_logs_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "review_logs_rating_check" CHECK ("review_logs"."rating" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary" (
	"user_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"added_from" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"personal_note" text,
	"receptive_mastery" real DEFAULT 0 NOT NULL,
	"productive_mastery" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_vocabulary_user_id_entry_id_pk" PRIMARY KEY("user_id","entry_id"),
	CONSTRAINT "user_vocabulary_status_check" CHECK ("user_vocabulary"."status" in ('new','learning','receptive_known','productive_developing','productive_known','difficult','suspended'))
);
--> statement-breakpoint
CREATE TABLE "vocabulary_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_id" text,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"part_of_speech" text NOT NULL,
	"ipa" text,
	"definition_zh" text NOT NULL,
	"example_en" text NOT NULL,
	"example_zh" text NOT NULL,
	"cefr_level" text NOT NULL,
	"source_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_cards" ADD CONSTRAINT "review_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cards" ADD CONSTRAINT "review_cards_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_review_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."review_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_entries" ADD CONSTRAINT "vocabulary_entries_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_cards_user_due_idx" ON "review_cards" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "review_logs_card_reviewed_idx" ON "review_logs" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_logs_user_reviewed_idx" ON "review_logs" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "vocabulary_entries_unit_id_idx" ON "vocabulary_entries" USING btree ("unit_id");
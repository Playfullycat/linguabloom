CREATE TABLE "pte_mock_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exam_version_id" text NOT NULL,
	"section" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"items" jsonb NOT NULL,
	"time_limit_seconds" integer NOT NULL,
	"elapsed_seconds" integer DEFAULT 0 NOT NULL,
	"end_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "pte_mock_tests_status_check" CHECK ("pte_mock_tests"."status" in ('in_progress','completed'))
);
--> statement-breakpoint
ALTER TABLE "pte_attempts" ADD COLUMN "mock_test_id" uuid;--> statement-breakpoint
ALTER TABLE "pte_mock_tests" ADD CONSTRAINT "pte_mock_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pte_mock_tests" ADD CONSTRAINT "pte_mock_tests_exam_version_id_exam_versions_id_fk" FOREIGN KEY ("exam_version_id") REFERENCES "public"."exam_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pte_mock_tests_user_idx" ON "pte_mock_tests" USING btree ("user_id","started_at");--> statement-breakpoint
ALTER TABLE "pte_attempts" ADD CONSTRAINT "pte_attempts_mock_test_id_pte_mock_tests_id_fk" FOREIGN KEY ("mock_test_id") REFERENCES "public"."pte_mock_tests"("id") ON DELETE set null ON UPDATE no action;
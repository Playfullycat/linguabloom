CREATE TABLE "can_do_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"can_do_id" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"outcome" text NOT NULL,
	"confidence" text NOT NULL,
	"weight" real NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "can_do_evidence_source_unique" UNIQUE("user_id","can_do_id","source","source_ref"),
	CONSTRAINT "can_do_evidence_outcome_check" CHECK ("can_do_evidence"."outcome" in ('pass','fail')),
	CONSTRAINT "can_do_evidence_confidence_check" CHECK ("can_do_evidence"."confidence" in ('low','medium','high'))
);
--> statement-breakpoint
CREATE TABLE "can_do_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"skill" text NOT NULL,
	"description_en" text NOT NULL,
	"description_zh" text NOT NULL,
	"origin" text NOT NULL,
	"prerequisites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pass_rule" jsonb NOT NULL,
	"sort_order" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "can_do_evidence" ADD CONSTRAINT "can_do_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "can_do_evidence" ADD CONSTRAINT "can_do_evidence_can_do_id_can_do_statements_id_fk" FOREIGN KEY ("can_do_id") REFERENCES "public"."can_do_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "can_do_evidence_user_idx" ON "can_do_evidence" USING btree ("user_id","can_do_id","occurred_at");--> statement-breakpoint
CREATE INDEX "can_do_statements_level_idx" ON "can_do_statements" USING btree ("level","skill");
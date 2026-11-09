CREATE TABLE "fluency_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_id" text NOT NULL,
	"level" text NOT NULL,
	"word_count" integer NOT NULL,
	"rounds" jsonb NOT NULL,
	"correct_count" smallint,
	"question_count" smallint,
	"duration_ms" integer NOT NULL,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluency_attempts_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "fluency_attempts_kind_check" CHECK ("fluency_attempts"."kind" in ('speed_reading','repeated_reading','timed_retell'))
);
--> statement-breakpoint
ALTER TABLE "fluency_attempts" ADD CONSTRAINT "fluency_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluency_attempts" ADD CONSTRAINT "fluency_attempts_content_id_learning_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."learning_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fluency_attempts_user_idx" ON "fluency_attempts" USING btree ("user_id","created_at");
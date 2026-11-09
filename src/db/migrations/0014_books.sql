CREATE TABLE "book_reading_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" text NOT NULL,
	"minutes" smallint NOT NULL,
	"pages" smallint,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_reading_logs_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "book_reading_logs_minutes_check" CHECK ("book_reading_logs"."minutes" between 1 and 600),
	CONSTRAINT "book_reading_logs_pages_check" CHECK ("book_reading_logs"."pages" is null or "book_reading_logs"."pages" between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"kind" text NOT NULL,
	"series" text,
	"series_level" text,
	"cefr_level" text NOT NULL,
	"level_note" text,
	"genre" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary_zh" text NOT NULL,
	"why_zh" text NOT NULL,
	"public_domain" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_kind_check" CHECK ("books"."kind" in ('graded_reader','original')),
	CONSTRAINT "books_genre_check" CHECK ("books"."genre" in ('fiction','nonfiction'))
);
--> statement-breakpoint
CREATE TABLE "user_books" (
	"user_id" uuid NOT NULL,
	"book_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_books_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "user_books_status_check" CHECK ("user_books"."status" in ('want','reading','finished'))
);
--> statement-breakpoint
ALTER TABLE "book_reading_logs" ADD CONSTRAINT "book_reading_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_reading_logs" ADD CONSTRAINT "book_reading_logs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_books" ADD CONSTRAINT "user_books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_books" ADD CONSTRAINT "user_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_reading_logs_user_idx" ON "book_reading_logs" USING btree ("user_id","created_at");
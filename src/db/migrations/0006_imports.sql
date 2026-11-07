CREATE TABLE "content_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"purpose" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text,
	"copyright_status" text NOT NULL,
	"source_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"parsed" jsonb NOT NULL,
	"suggested_level" text,
	"media_asset_id" uuid,
	"content_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "content_imports_status_check" CHECK ("content_imports"."status" in ('draft','published','discarded'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"original_name" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vocabulary_entries" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_content_id_learning_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."learning_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_imports_user_idx" ON "content_imports" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "vocabulary_entries" ADD CONSTRAINT "vocabulary_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vocabulary_entries_owner_idx" ON "vocabulary_entries" USING btree ("owner_user_id");
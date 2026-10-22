ALTER TABLE "notes" ADD COLUMN "author_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "author_name" text DEFAULT 'Sistema' NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_author_idx" ON "notes" USING btree ("author_type","author_id");
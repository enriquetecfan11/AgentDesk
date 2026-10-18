ALTER TABLE "webhooks" ADD COLUMN "last_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "last_status" integer;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "delivery_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;
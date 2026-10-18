CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_autonomy" AS ENUM('suggest_only', 'do_with_approval', 'autonomous_low_risk');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"tool" text NOT NULL,
	"risk" "risk_level" DEFAULT 'high' NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_edited" jsonb,
	"reason" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "autonomy" "task_autonomy" DEFAULT 'do_with_approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claim_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approvals_task_idx" ON "approvals" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "approvals_agent_idx" ON "approvals" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "approvals_pending_expiry_idx" ON "approvals" USING btree ("expires_at") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_idempotency_unique" ON "approvals" USING btree ("agent_id","idempotency_key") WHERE "approvals"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claimed_by_agent_id_agents_id_fk" FOREIGN KEY ("claimed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_lease_idx" ON "tasks" USING btree ("lease_expires_at") WHERE "tasks"."lease_expires_at" is not null;
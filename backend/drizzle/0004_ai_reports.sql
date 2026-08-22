CREATE TABLE "ai_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"input_hash" text NOT NULL,
	"report" jsonb NOT NULL,
	"narrative_source" text DEFAULT 'rules' NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_reports_ws_idx" ON "ai_reports" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_reports_ws_hash_idx" ON "ai_reports" USING btree ("workspace_id","input_hash");
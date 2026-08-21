CREATE TABLE "compensation_configs" (
	"workspace_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"kind" text DEFAULT 'variable' NOT NULL,
	"fixed_amount" numeric(12, 2),
	"fixed_currency" text,
	"fixed_period" text,
	"variable_notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_configs_workspace_id_moderator_id_pk" PRIMARY KEY("workspace_id","moderator_id")
);
--> statement-breakpoint
CREATE TABLE "content_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"platform" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"owner_user_id" uuid,
	"assigned_moderator_id" uuid,
	"notes" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_config" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"rate" numeric(12, 6) DEFAULT '0.01' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_channel_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"last_message_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_channel_cursors_ws_channel_key" UNIQUE("workspace_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "discord_member_tenure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_ref" text NOT NULL,
	"joined_at" timestamp with time zone,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_member_tenure_ws_member_key" UNIQUE("workspace_id","member_ref")
);
--> statement-breakpoint
CREATE TABLE "discord_membership_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_members" integer DEFAULT 0 NOT NULL,
	"new_members" integer DEFAULT 0 NOT NULL,
	"left_members" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"source" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_forms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "discovery_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid,
	"slug_snapshot" text,
	"respondent_name" text,
	"respondent_email" text,
	"respondent_role" text,
	"answers" jsonb NOT NULL,
	"user_agent" text,
	"completion_ms" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"rating" integer,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_rating_chk" CHECK ("feedback"."rating" is null or "feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"action_taken" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_state" (
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_snapshot_at" timestamp with time zone,
	"last_metrics" jsonb,
	"last_error" text,
	CONSTRAINT "integration_sync_state_workspace_id_platform_pk" PRIMARY KEY("workspace_id","platform")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"credentials_enc" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_workspace_platform_key" UNIQUE("workspace_id","platform")
);
--> statement-breakpoint
CREATE TABLE "kols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"channel" text,
	"reach" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"last_activity" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"meet_link" text,
	"attendee_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"attendee_moderator_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_range_chk" CHECK ("meetings"."ends_at" > "meetings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "member_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text DEFAULT 'telegram' NOT NULL,
	"member_ref" text NOT NULL,
	"display_name" text,
	"day" date DEFAULT current_date NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_messages_ws_platform_member_day_key" UNIQUE("workspace_id","platform","member_ref","day")
);
--> statement-breakpoint
CREATE TABLE "message_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_activity_ws_platform_bucket_key" UNIQUE("workspace_id","platform","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "moderator_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric(14, 4) DEFAULT '0' NOT NULL,
	"period" text DEFAULT 'current' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderator_metrics_key" UNIQUE("workspace_id","moderator_id","metric_key","period")
);
--> statement-breakpoint
CREATE TABLE "moderator_response_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"day" date NOT NULL,
	"responses_count" integer DEFAULT 0 NOT NULL,
	"avg_response_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mrm_mod_platform_day_key" UNIQUE("moderator_id","platform","day")
);
--> statement-breakpoint
CREATE TABLE "moderator_shift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"day" date NOT NULL,
	"expected_start_utc" timestamp with time zone NOT NULL,
	"expected_end_utc" timestamp with time zone NOT NULL,
	"first_activity_utc" timestamp with time zone,
	"was_on_time" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mse_mod_day_key" UNIQUE("moderator_id","day")
);
--> statement-breakpoint
CREATE TABLE "moderators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"discord_handle" text,
	"telegram_handle" text,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"start_date" date,
	"contract_type" text DEFAULT 'Volunteer' NOT NULL,
	"timezone" text,
	"country" text,
	"status" text DEFAULT 'Off Duty' NOT NULL,
	"notes" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bio" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"platforms_known" text[] DEFAULT '{}'::text[] NOT NULL,
	"external_source" text,
	"profile_photo_url" text,
	"cv_storage_path" text,
	"cv_filename" text,
	"cv_extracted_text" text,
	"shift_start_utc" integer,
	"shift_end_utc" integer,
	"shift_days" integer[] DEFAULT '{1,2,3,4,5}'::int[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderators_ws_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "moderators_shift_start_chk" CHECK ("moderators"."shift_start_utc" is null or "moderators"."shift_start_utc" between 0 and 23),
	CONSTRAINT "moderators_shift_end_chk" CHECK ("moderators"."shift_end_utc" is null or "moderators"."shift_end_utc" between 0 and 23)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period" text,
	"note" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"date" date DEFAULT current_date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_metrics_ws_platform_date_key" UNIQUE("workspace_id","platform","date")
);
--> statement-breakpoint
CREATE TABLE "points_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"label" text NOT NULL,
	"points" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_config_ws_metric_key" UNIQUE("workspace_id","metric_key")
);
--> statement-breakpoint
CREATE TABLE "processed_telegram_updates" (
	"workspace_id" uuid NOT NULL,
	"update_id" bigint NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_telegram_updates_workspace_id_update_id_pk" PRIMARY KEY("workspace_id","update_id")
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"report_type" text DEFAULT 'general' NOT NULL,
	"cadence" text DEFAULT 'off' NOT NULL,
	"weekday" integer,
	"time" text DEFAULT '21:00' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"recipient_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp with time zone,
	"slack_webhook_url_enc" text,
	"notion_token_enc" text,
	"notion_page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "report_schedules_weekday_chk" CHECK ("report_schedules"."weekday" is null or "report_schedules"."weekday" between 0 and 6),
	CONSTRAINT "report_schedules_time_chk" CHECK ("report_schedules"."time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "resource_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"section_type" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"viewer_user_id" uuid,
	"viewer_moderator_id" uuid,
	"viewer_label" text,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_path" text,
	"external_url" text,
	"mime_type" text,
	"size_bytes" bigint,
	"visibility" text DEFAULT 'team' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_kind_chk" CHECK (("resources"."kind" = 'file' and "resources"."storage_path" is not null) or ("resources"."kind" = 'external_link' and "resources"."external_url" is not null))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee" text,
	"area" text,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'To Do' NOT NULL,
	"start_date" date,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"user_ref" text NOT NULL,
	"display_name" text,
	"event_type" text NOT NULL,
	"old_status" text,
	"new_status" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tme_dedup_key" UNIQUE("workspace_id","chat_id","user_ref","event_type","occurred_at")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"platform" text,
	"quantity" numeric(14, 4) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'call' NOT NULL,
	"cost_hint_usd" numeric(10, 6),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"job_role" text,
	"manages_multiple" boolean,
	"community_size" text,
	"primary_platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"timezone" text,
	"onboarded_at" timestamp with time zone,
	"layout_prompt_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"project_type" text,
	"community_size" text,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"imported_by" uuid,
	"filename" text,
	"period_start" date,
	"period_end" date,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compensation_configs" ADD CONSTRAINT "compensation_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_configs" ADD CONSTRAINT "compensation_configs_moderator_fk" FOREIGN KEY ("workspace_id","moderator_id") REFERENCES "public"."moderators"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_schedule" ADD CONSTRAINT "content_schedule_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_schedule" ADD CONSTRAINT "content_schedule_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_schedule" ADD CONSTRAINT "content_schedule_assigned_moderator_id_moderators_id_fk" FOREIGN KEY ("assigned_moderator_id") REFERENCES "public"."moderators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_config" ADD CONSTRAINT "conversion_config_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_channel_cursors" ADD CONSTRAINT "discord_channel_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_member_tenure" ADD CONSTRAINT "discord_member_tenure_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_membership_snapshots" ADD CONSTRAINT "discord_membership_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_form_id_discovery_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."discovery_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kols" ADD CONSTRAINT "kols_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_activity" ADD CONSTRAINT "message_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_metrics" ADD CONSTRAINT "moderator_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_metrics" ADD CONSTRAINT "moderator_metrics_moderator_fk" FOREIGN KEY ("workspace_id","moderator_id") REFERENCES "public"."moderators"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_response_metrics" ADD CONSTRAINT "moderator_response_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_response_metrics" ADD CONSTRAINT "mrm_moderator_fk" FOREIGN KEY ("workspace_id","moderator_id") REFERENCES "public"."moderators"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_shift_events" ADD CONSTRAINT "moderator_shift_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_shift_events" ADD CONSTRAINT "mse_moderator_fk" FOREIGN KEY ("workspace_id","moderator_id") REFERENCES "public"."moderators"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderators" ADD CONSTRAINT "moderators_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_moderator_fk" FOREIGN KEY ("workspace_id","moderator_id") REFERENCES "public"."moderators"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_metric_snapshots" ADD CONSTRAINT "platform_metric_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_metrics" ADD CONSTRAINT "platform_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_config" ADD CONSTRAINT "points_config_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_telegram_updates" ADD CONSTRAINT "processed_telegram_updates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_folders" ADD CONSTRAINT "resource_folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_folders" ADD CONSTRAINT "resource_folders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_views" ADD CONSTRAINT "resource_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_views" ADD CONSTRAINT "resource_views_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_views" ADD CONSTRAINT "resource_views_viewer_user_id_user_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_views" ADD CONSTRAINT "resource_views_viewer_moderator_id_moderators_id_fk" FOREIGN KEY ("viewer_moderator_id") REFERENCES "public"."moderators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_folder_id_resource_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."resource_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_membership_events" ADD CONSTRAINT "telegram_membership_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_imports" ADD CONSTRAINT "x_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_imports" ADD CONSTRAINT "x_imports_imported_by_user_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_schedule_ws_time_idx" ON "content_schedule" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "dmt_ws_joined_idx" ON "discord_member_tenure" USING btree ("workspace_id","joined_at");--> statement-breakpoint
CREATE INDEX "dms_ws_time_idx" ON "discord_membership_snapshots" USING btree ("workspace_id","captured_at");--> statement-breakpoint
CREATE INDEX "discovery_responses_form_idx" ON "discovery_responses" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "discovery_responses_time_idx" ON "discovery_responses" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_ws_date_idx" ON "incidents" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "kols_ws_idx" ON "kols" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "meetings_ws_time_idx" ON "meetings" USING btree ("workspace_id","starts_at");--> statement-breakpoint
CREATE INDEX "member_messages_ws_day_idx" ON "member_messages" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "message_activity_ws_bucket_idx" ON "message_activity" USING btree ("workspace_id","bucket_start");--> statement-breakpoint
CREATE INDEX "mrm_ws_day_idx" ON "moderator_response_metrics" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "mse_ws_day_idx" ON "moderator_shift_events" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "moderators_ws_idx" ON "moderators" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "payments_ws_paid_idx" ON "payments" USING btree ("workspace_id","paid_at");--> statement-breakpoint
CREATE INDEX "pms_ws_platform_time_idx" ON "platform_metric_snapshots" USING btree ("workspace_id","platform","captured_at");--> statement-breakpoint
CREATE INDEX "report_runs_ws_idx" ON "report_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "resource_folders_ws_idx" ON "resource_folders" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "resource_views_resource_idx" ON "resource_views" USING btree ("resource_id","viewed_at");--> statement-breakpoint
CREATE INDEX "resource_views_ws_idx" ON "resource_views" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "resources_ws_idx" ON "resources" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "resources_folder_idx" ON "resources" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "tasks_ws_idx" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tme_ws_time_idx" ON "telegram_membership_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_ws_time_idx" ON "usage_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_type_time_idx" ON "usage_events" USING btree ("user_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "x_imports_ws_idx" ON "x_imports" USING btree ("workspace_id","created_at");
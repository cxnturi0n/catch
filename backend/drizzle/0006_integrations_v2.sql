CREATE TABLE "channel_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"channel_id" text NOT NULL,
	"day" date NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_activity_key" UNIQUE("workspace_id","platform","channel_id","day")
);
--> statement-breakpoint
CREATE TABLE "discord_gateway_state" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"worker_id" text,
	"connected_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_ack_at" timestamp with time zone,
	"session_id" text,
	"resume_url" text,
	"seq" integer,
	"intents" integer,
	"missing_intents" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_close_code" integer,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_ref" text NOT NULL,
	"display_name" text,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dme_dedup_key" UNIQUE("workspace_id","member_ref","event_type","occurred_at")
);
--> statement-breakpoint
CREATE TABLE "moderator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"action_id" text NOT NULL,
	"action_type" text NOT NULL,
	"executor_ref" text NOT NULL,
	"executor_name" text,
	"target_ref" text,
	"target_name" text,
	"channel_id" text,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderator_actions_ws_platform_action_key" UNIQUE("workspace_id","platform","action_id")
);
--> statement-breakpoint
CREATE TABLE "platform_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text,
	"type" text,
	"parent_id" text,
	"position" integer,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_channels_ws_platform_chan_key" UNIQUE("workspace_id","platform","channel_id")
);
--> statement-breakpoint
CREATE TABLE "platform_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"member_ref" text NOT NULL,
	"display_name" text,
	"reply_to_message_id" text,
	"sent_at" timestamp with time zone NOT NULL,
	"content_enc" text,
	"has_content" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'gateway' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_messages_ws_platform_msg_key" UNIQUE("workspace_id","platform","message_id")
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "webhook_secret_hash" text;--> statement-breakpoint
ALTER TABLE "moderators" ADD COLUMN "discord_user_id" text;--> statement-breakpoint
ALTER TABLE "moderators" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
ALTER TABLE "channel_activity" ADD CONSTRAINT "channel_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_gateway_state" ADD CONSTRAINT "discord_gateway_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_membership_events" ADD CONSTRAINT "discord_membership_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_actions" ADD CONSTRAINT "moderator_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_channels" ADD CONSTRAINT "platform_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_messages" ADD CONSTRAINT "platform_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_activity_ws_day_idx" ON "channel_activity" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE INDEX "dme_ws_time_idx" ON "discord_membership_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "moderator_actions_ws_time_idx" ON "moderator_actions" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "moderator_actions_ws_exec_idx" ON "moderator_actions" USING btree ("workspace_id","platform","executor_ref");--> statement-breakpoint
CREATE INDEX "platform_messages_ws_sent_idx" ON "platform_messages" USING btree ("workspace_id","sent_at");--> statement-breakpoint
CREATE INDEX "platform_messages_ws_chan_sent_idx" ON "platform_messages" USING btree ("workspace_id","platform","channel_id","sent_at");--> statement-breakpoint
CREATE INDEX "integrations_webhook_hash_idx" ON "integrations" USING btree ("webhook_secret_hash");
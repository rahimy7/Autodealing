CREATE TYPE "public"."contact_tag" AS ENUM('lead', 'vip', 'in_process', 'support');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('admin', 'agent');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('online', 'busy', 'offline');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('human', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'instagram', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."conversation_label" AS ENUM('lead', 'vip', 'in_process', 'support');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'resolved', 'bot', 'pending');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('contact', 'agent', 'bot');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'document', 'audio', 'video', 'template');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('marketing', 'utility', 'authentication');--> statement-breakpoint
CREATE TYPE "public"."campaign_recipient_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."label_kind" AS ENUM('intent', 'locality');--> statement-breakpoint
CREATE TYPE "public"."group_distribution_rule" AS ENUM('round_robin', 'least_busy', 'by_capability', 'manual');--> statement-breakpoint
CREATE TYPE "public"."feed_thread_status" AS ENUM('open', 'resolved', 'migrated');--> statement-breakpoint
CREATE TYPE "public"."feed_comment_delivery" AS ENUM('public_reply', 'private_reply', 'none');--> statement-breakpoint
CREATE TYPE "public"."feed_comment_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."appointment_source" AS ENUM('ai', 'agent', 'admin');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"external_id" text,
	"phone" text,
	"email" text,
	"avatar" text,
	"company" text,
	"address" text,
	"city" text,
	"birthday" text,
	"tag" "contact_tag",
	"channels" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"buyer_status" text,
	"interests" text[] DEFAULT '{}' NOT NULL,
	"purchase_profile" text,
	"total_conversations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"avatar" text,
	"password_hash" text,
	"status" "agent_status" DEFAULT 'offline' NOT NULL,
	"active_chats" integer DEFAULT 0 NOT NULL,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"type" "agent_type" DEFAULT 'human' NOT NULL,
	"role" "agent_role" DEFAULT 'agent' NOT NULL,
	"profile_type" text,
	"system_prompt" text,
	"model" text,
	"escalate_to_agent_id" integer,
	"escalate_to_group_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"contact_id" integer NOT NULL,
	"agent_id" integer,
	"external_id" text,
	"label" "conversation_label",
	"label_id" integer,
	"locality_label_id" integer,
	"group_id" integer,
	"context_summary" text,
	"history_summary" text,
	"session_started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"last_message" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender" "message_sender" NOT NULL,
	"content" text NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"media_url" text,
	"is_ai_suggestion" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"type" "campaign_type" NOT NULL,
	"mode" text DEFAULT 'freeform' NOT NULL,
	"message" text,
	"template_name" text,
	"template_language" text,
	"payload" jsonb,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"contact_id" integer,
	"channel" text NOT NULL,
	"recipient_external_id" text,
	"status" "campaign_recipient_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"handoff_to_agent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "label_kind" DEFAULT 'intent' NOT NULL,
	"color" text DEFAULT '#14b8a6' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_safe_for_auto_reply" boolean DEFAULT false NOT NULL,
	"auto_migrate_to_dm" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"channels" "channel"[],
	"is_active" boolean DEFAULT true NOT NULL,
	"graph" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"properties" text[] DEFAULT '{}' NOT NULL,
	"uses" text,
	"url" text NOT NULL,
	"image_url" text,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"category_paths" text[] DEFAULT '{}' NOT NULL,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"technical_sheet_url" text,
	"safety_sheet_url" text,
	"source_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'welcome' NOT NULL,
	"body" text NOT NULL,
	"image_path" text,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"knowledge_base_id" integer,
	"category" text,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"examples" text,
	"level" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"distribution_rule" "group_distribution_rule" DEFAULT 'round_robin' NOT NULL,
	"rotation_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_name" text DEFAULT 'Plan Mensual' NOT NULL,
	"monthly_price" integer DEFAULT 300 NOT NULL,
	"messages_limit" integer DEFAULT 1000 NOT NULL,
	"agents_limit" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"meta_app_id" text,
	"meta_app_secret" text,
	"webhook_verify_token" text,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_phone_number_id" text,
	"whatsapp_business_account_id" text,
	"whatsapp_display_number" text,
	"whatsapp_access_token" text,
	"facebook_enabled" boolean DEFAULT false NOT NULL,
	"facebook_page_id" text,
	"facebook_page_access_token" text,
	"instagram_enabled" boolean DEFAULT false NOT NULL,
	"instagram_business_account_id" text,
	"instagram_access_token" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "feed_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" "channel" NOT NULL,
	"external_post_id" text NOT NULL,
	"permalink" text,
	"caption" text,
	"media_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" "channel" NOT NULL,
	"post_id" integer NOT NULL,
	"external_root_comment_id" text NOT NULL,
	"contact_id" integer,
	"agent_id" integer,
	"status" "feed_thread_status" DEFAULT 'open' NOT NULL,
	"migrated_conversation_id" integer,
	"label_id" integer,
	"last_comment_at" timestamp DEFAULT now() NOT NULL,
	"last_comment" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"external_comment_id" text,
	"parent_external_comment_id" text,
	"direction" "feed_comment_direction" NOT NULL,
	"delivery" "feed_comment_delivery" DEFAULT 'none' NOT NULL,
	"author_name" text,
	"author_agent_id" integer,
	"content" text NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"is_ai_suggestion" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"platform" "device_platform" DEFAULT 'android' NOT NULL,
	"agent_id" integer,
	"user_email" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"device_name" text,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"conversation_id" integer,
	"agent_id" integer,
	"service" text NOT NULL,
	"notes" text,
	"location" text,
	"starts_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"status" "appointment_status" DEFAULT 'pending' NOT NULL,
	"source" "appointment_source" DEFAULT 'admin' NOT NULL,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"modules_json" text,
	"branding_json" text,
	"subscription_status" text DEFAULT 'active' NOT NULL,
	"subscription_paid_until" timestamp,
	"monthly_price" integer DEFAULT 0 NOT NULL,
	"blocked_manually" boolean DEFAULT false NOT NULL,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_active_slug_unique" ON "labels" USING btree ("slug") WHERE "labels"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_messages_active_kind_idx" ON "custom_messages" USING btree ("kind") WHERE "custom_messages"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "feed_posts_channel_post_unique" ON "feed_posts" USING btree ("channel","external_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_threads_post_root_unique" ON "feed_threads" USING btree ("post_id","external_root_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_comments_external_unique" ON "feed_comments" USING btree ("external_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "appointments_starts_at_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "appointments_contact_idx" ON "appointments" USING btree ("contact_id");
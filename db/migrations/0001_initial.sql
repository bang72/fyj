-- MIVO V2 baseline PostgreSQL schema.
-- PostgreSQL/Neon production schema for Vercel deployments.
BEGIN;
CREATE TABLE "rate_limits" (
	"key_hash" text NOT NULL,
	"action" text NOT NULL,
	"window_start" integer NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	PRIMARY KEY("key_hash", "action", "window_start")
);

CREATE TABLE "subscription_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"processed_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);

CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"username" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"trust_band" text DEFAULT 'new' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text
);

CREATE TABLE "verification_status" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"checked_at" text,
	"expires_at" text,
	"provider_reference" text,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "vibes" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"active" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "admin_bootstrap_state" (
	"id" text PRIMARY KEY NOT NULL,
	"bootstrapped_by_id" text NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("bootstrapped_by_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict
);

CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"reason" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"password_algorithm" text NOT NULL,
	"password_iterations" integer NOT NULL,
	"password_changed_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "daily_entitlements" (
	"user_id" text NOT NULL,
	"entitlement_date" text NOT NULL,
	"filtered_matches_used" integer DEFAULT 0 NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	PRIMARY KEY("user_id", "entitlement_date"),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "identities" (
	"user_id" text PRIMARY KEY NOT NULL,
	"birth_date" text NOT NULL,
	"gender" text NOT NULL,
	"region" text,
	"city" text,
	"photo_key" text,
	"contact_type" text,
	"contact_value" text,
	"age_visibility" text DEFAULT 'range' NOT NULL,
	"location_consent" integer DEFAULT 0 NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "matchmaking_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"desired_gender" text NOT NULL,
	"vibes_json" text NOT NULL,
	"expanded" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"claim_token" text,
	"claimed_at" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"expires_at" text NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_public_id" text,
	"read_at" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"desired_gender" text DEFAULT 'random' NOT NULL,
	"read_receipts" integer DEFAULT 1 NOT NULL,
	"sensitive_media" text DEFAULT 'block' NOT NULL,
	"reconnect_policy" text DEFAULT 'allow' NOT NULL,
	"appearance" text DEFAULT 'dark' NOT NULL,
	"push_enabled" integer DEFAULT 0 NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"connection_id" text,
	"last_heartbeat_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"avatar_hue" integer DEFAULT 250 NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"used_at" text,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"match_mode" text NOT NULL,
	"vibe_score" integer DEFAULT 0 NOT NULL,
	"message_seq" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"ended_by_id" text,
	"end_reason" text,
	"retention_until" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"ended_at" text,
	FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "second_chance_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"target_id" text NOT NULL,
	"target_decision" text DEFAULT 'pending' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"expires_at" text NOT NULL,
	"resolved_at" text,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("target_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "security_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"fingerprint_hash" text,
	"event_type" text NOT NULL,
	"severity" integer DEFAULT 0 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_label" text NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_seen_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"plan" text DEFAULT 'FREE' NOT NULL,
	"status" text NOT NULL,
	"current_period_start" text,
	"current_period_end" text,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "trust_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"score_delta" integer NOT NULL,
	"reference_id" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "user_vibes" (
	"user_id" text NOT NULL,
	"vibe_id" text NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	PRIMARY KEY("user_id", "vibe_id"),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("vibe_id") REFERENCES "vibes"("id") ON UPDATE no action ON DELETE restrict
);

CREATE TABLE "vibe_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_a_choice" text,
	"user_b_choice" text,
	"result" text DEFAULT 'pending' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"resolved_at" text,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "active_room_locks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"source_room_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("source_room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "identity_reveal_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"layer" integer NOT NULL,
	"initiated_by_id" text NOT NULL,
	"user_a_approved" integer,
	"user_b_approved" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"resolved_at" text,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict
);

CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"room_id" text NOT NULL,
	"match_mode" text NOT NULL,
	"vibe_score" integer NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade
);

CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"room_id" text NOT NULL,
	"sender_id" text,
	"sequence" integer NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"body_hash" text,
	"reply_to_id" text,
	"delivered_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reported_user_id" text NOT NULL,
	"room_id" text,
	"message_id" text,
	"category" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"resolved_at" text,
	FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE set null,
	FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "room_members" (
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"anonymous_alias" text NOT NULL,
	"connection_level" text DEFAULT 'stranger' NOT NULL,
	"retention_choice" text DEFAULT 'chat' NOT NULL,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	"typing_until" text,
	"joined_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"left_at" text,
	PRIMARY KEY("room_id", "user_id"),
	FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict
);

CREATE TABLE "moderation_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"moderator_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"report_id" text,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" text,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON UPDATE no action ON DELETE set null
);

CREATE TABLE "report_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"evidence_type" text NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"expires_at" text NOT NULL,
	FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON UPDATE no action ON DELETE cascade
);

CREATE INDEX "audit_action_idx" ON "audit_events" ("action","created_at");

CREATE UNIQUE INDEX "blocks_pair_unique" ON "blocks" ("blocker_id","blocked_id");

CREATE INDEX "blocks_reverse_idx" ON "blocks" ("blocked_id","blocker_id");

CREATE UNIQUE INDEX "connections_public_id_unique" ON "connections" ("public_id");

CREATE UNIQUE INDEX "connections_pair_unique" ON "connections" ("user_a_id","user_b_id");

CREATE INDEX "connections_a_idx" ON "connections" ("user_a_id","status");

CREATE INDEX "connections_b_idx" ON "connections" ("user_b_id","status");

CREATE UNIQUE INDEX "reveal_room_layer_unique" ON "identity_reveal_requests" ("room_id","layer");

CREATE INDEX "reveal_status_idx" ON "identity_reveal_requests" ("status","created_at");

CREATE INDEX "matches_pair_recent_idx" ON "matches" ("user_a_id","user_b_id","created_at");

CREATE UNIQUE INDEX "matches_room_unique" ON "matches" ("room_id");

CREATE UNIQUE INDEX "queue_user_unique" ON "matchmaking_queue" ("user_id");

CREATE INDEX "queue_match_idx" ON "matchmaking_queue" ("status","desired_gender","created_at");

CREATE INDEX "queue_expiry_idx" ON "matchmaking_queue" ("expires_at");

CREATE UNIQUE INDEX "messages_public_id_unique" ON "messages" ("public_id");

CREATE UNIQUE INDEX "messages_room_sequence_unique" ON "messages" ("room_id","sequence");

CREATE INDEX "messages_room_history_idx" ON "messages" ("room_id","sequence");

CREATE INDEX "messages_sender_recent_idx" ON "messages" ("sender_id","created_at");

CREATE INDEX "moderation_target_idx" ON "moderation_actions" ("target_user_id","created_at");

CREATE UNIQUE INDEX "notifications_public_id_unique" ON "notifications" ("public_id");

CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","read_at","created_at");

CREATE INDEX "rate_limits_cleanup_idx" ON "rate_limits" ("window_start");

CREATE UNIQUE INDEX "recovery_code_hash_unique" ON "recovery_codes" ("code_hash");

CREATE INDEX "recovery_user_idx" ON "recovery_codes" ("user_id");

CREATE INDEX "report_evidence_report_idx" ON "report_evidence" ("report_id");

CREATE UNIQUE INDEX "reports_public_id_unique" ON "reports" ("public_id");

CREATE INDEX "reports_status_priority_idx" ON "reports" ("status","priority","created_at");

CREATE INDEX "room_members_user_idx" ON "room_members" ("user_id","joined_at");

CREATE UNIQUE INDEX "rooms_public_id_unique" ON "rooms" ("public_id");

CREATE INDEX "rooms_a_status_idx" ON "rooms" ("user_a_id","status","created_at");

CREATE INDEX "rooms_b_status_idx" ON "rooms" ("user_b_id","status","created_at");

CREATE UNIQUE INDEX "second_chance_room_requester_unique" ON "second_chance_requests" ("room_id","requested_by_id");

CREATE INDEX "second_chance_target_idx" ON "second_chance_requests" ("target_id","target_decision","created_at");

CREATE INDEX "security_user_event_idx" ON "security_events" ("user_id","event_type","created_at");

CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id","expires_at");

CREATE INDEX "sessions_expiry_idx" ON "sessions" ("expires_at");

CREATE UNIQUE INDEX "subscription_event_unique" ON "subscription_events" ("provider","provider_event_id");

CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" ("user_id","status","current_period_end");

CREATE UNIQUE INDEX "subscriptions_provider_id_unique" ON "subscriptions" ("provider","provider_subscription_id");

CREATE INDEX "trust_events_user_idx" ON "trust_events" ("user_id","created_at");

CREATE INDEX "user_vibes_vibe_idx" ON "user_vibes" ("vibe_id","user_id");

CREATE UNIQUE INDEX "users_public_id_unique" ON "users" ("public_id");

CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username");

CREATE INDEX "users_status_created_idx" ON "users" ("status","created_at");

CREATE UNIQUE INDEX "vibe_checks_room_unique" ON "vibe_checks" ("room_id");

CREATE UNIQUE INDEX "vibes_label_unique" ON "vibes" ("label");

CREATE INDEX "active_room_locks_room_idx" ON "active_room_locks" ("room_id");

CREATE INDEX "presence_heartbeat_idx" ON "presence" ("last_heartbeat_at");
COMMIT;

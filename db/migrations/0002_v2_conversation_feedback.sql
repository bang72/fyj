-- MIVO V2: private post-conversation feedback.
CREATE TABLE "conversation_feedback" (
  "room_id" text NOT NULL,
  "user_id" text NOT NULL,
  "rating" text NOT NULL,
  "created_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
  "updated_at" text DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
  PRIMARY KEY("room_id", "user_id"),
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);

CREATE INDEX "conversation_feedback_rating_idx" ON "conversation_feedback" ("rating", "created_at");

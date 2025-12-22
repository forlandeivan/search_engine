ALTER TABLE "chat_sessions"
  ADD COLUMN "current_assistant_action_type" text,
  ADD COLUMN "current_assistant_action_text" text,
  ADD COLUMN "current_assistant_action_trigger_message_id" text,
  ADD COLUMN "current_assistant_action_updated_at" timestamp;

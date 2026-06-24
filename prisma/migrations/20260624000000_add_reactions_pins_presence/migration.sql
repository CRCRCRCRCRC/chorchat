ALTER TABLE "messages"
ADD COLUMN "pinned_at" TIMESTAMP(3),
ADD COLUMN "pinned_by" "Sender";

CREATE INDEX "messages_pinned_at_idx" ON "messages"("pinned_at");

CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sender" "Sender" NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_reactions_message_id_sender_emoji_key"
ON "message_reactions"("message_id", "sender", "emoji");

CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

ALTER TABLE "message_reactions"
ADD CONSTRAINT "message_reactions_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "presence" (
    "sender" "Sender" NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presence_pkey" PRIMARY KEY ("sender")
);

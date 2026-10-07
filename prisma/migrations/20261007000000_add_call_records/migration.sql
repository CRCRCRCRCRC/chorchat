CREATE TABLE "call_records" (
    "id" TEXT NOT NULL,
    "caller" "Sender" NOT NULL,
    "callee" "Sender" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by" "Sender",
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "call_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "call_records_started_at_idx" ON "call_records"("started_at");
CREATE INDEX "call_records_status_last_activity_at_idx" ON "call_records"("status", "last_activity_at");

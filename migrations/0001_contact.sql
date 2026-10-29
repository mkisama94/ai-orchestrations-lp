-- Migration: 0001_contact.sql
-- Purpose: Inquiries storage, operator notification outbox jobs, and short-lived IP rate limit counters.

CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('business', 'partnership', 'product', 'open_estimate', 'security', 'other')),
  service TEXT NOT NULL CHECK (service IN ('general', 'oshieai', 'datacenter', 'open_estimate', 'other', 'unknown')),
  context TEXT NOT NULL CHECK (context IN ('home', 'oshieai', 'datacenter')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  organization TEXT,
  phone TEXT,
  reference TEXT,
  privacy_version TEXT NOT NULL,
  privacy_accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retention_until TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created_at
  ON inquiries (created_at);

CREATE INDEX IF NOT EXISTS idx_inquiries_retention_until
  ON inquiries (retention_until);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('operator_notification')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (inquiry_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_next_attempt
  ON notification_jobs (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_lease_until
  ON notification_jobs (status, lease_until);

-- Separate short-lived rate limit counter table (cleaned up within 24h after bucket expiration; never stores raw IP)
CREATE TABLE IF NOT EXISTS contact_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_contact_rate_limits_expires_at
  ON contact_rate_limits (expires_at);

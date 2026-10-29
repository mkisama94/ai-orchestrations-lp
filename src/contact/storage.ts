/**
 * D1 persistence layer for inquiries, notification jobs, idempotency, and rate limiting.
 */

import type { NormalizedContactInput } from "./schema.ts";

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>;
}

export interface StoredInquirySummary {
  id: string;
  receipt_id: string;
  idempotency_key: string;
  payload_hash: string;
  created_at: string;
}

export type SaveInquiryOutcome =
  | {
      status: "created";
      inquiryId: string;
      jobId: string;
      receiptId: string;
      receivedAt: string;
    }
  | {
      status: "duplicate_accepted";
      inquiryId: string;
      receiptId: string;
      receivedAt: string;
    }
  | {
      status: "conflict";
    }
  | {
      status: "db_error";
    };

const RECEIPT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateReceiptId(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += RECEIPT_ALPHABET[bytes[i] % RECEIPT_ALPHABET.length];
  }
  return `AIO-${code}`;
}

export function computeRetentionUntilIso(now: Date, retentionDays = 365): string {
  const until = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  return until.toISOString();
}

export async function computeIpHash(ip: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || "default-fallback-secret-change-in-prod"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(ip));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkRateLimit(params: {
  db: D1DatabaseLike;
  ipHash: string;
  nowMs?: number;
  windowSeconds?: number;
  maxRequests?: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number; count: number }> {
  const {
    db,
    ipHash,
    nowMs = Date.now(),
    windowSeconds = 600,
    maxRequests = 10,
  } = params;

  const nowSeconds = Math.floor(nowMs / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const bucketKey = `${ipHash}:${windowStart}`;
  // Expire within 24 hours after bucket window ends
  const expiresAtIso = new Date((windowStart + windowSeconds + 24 * 3600) * 1000).toISOString();

  const upsertStmt = db
    .prepare(
      `INSERT INTO contact_rate_limits (bucket_key, ip_hash, window_start, expires_at, count)
       VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`
    )
    .bind(bucketKey, ipHash, windowStart, expiresAtIso);

  const selectStmt = db
    .prepare(`SELECT count FROM contact_rate_limits WHERE bucket_key = ?1`)
    .bind(bucketKey);

  await db.batch([upsertStmt, selectStmt]);
  const row = await selectStmt.first<{ count: number }>();
  const count = typeof row?.count === "number" ? row.count : 1;
  const retryAfterSeconds = Math.max(1, windowStart + windowSeconds - nowSeconds);

  return {
    allowed: count <= maxRequests,
    retryAfterSeconds,
    count,
  };
}

export async function cleanupExpiredRateLimits(
  db: D1DatabaseLike,
  nowIso: string = new Date().toISOString()
): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM contact_rate_limits WHERE expires_at <= ?1`)
    .bind(nowIso)
    .run();
  return res.meta?.changes ?? 0;
}

export async function findInquiryByIdempotencyKey(
  db: D1DatabaseLike,
  idempotencyKey: string
): Promise<StoredInquirySummary | null> {
  return await db
    .prepare(
      `SELECT id, receipt_id, idempotency_key, payload_hash, created_at
       FROM inquiries
       WHERE idempotency_key = ?1`
    )
    .bind(idempotencyKey)
    .first<StoredInquirySummary>();
}

export async function saveInquiryWithOutboxJob(params: {
  db: D1DatabaseLike;
  idempotencyKey: string;
  payloadHash: string;
  input: NormalizedContactInput;
  now?: Date;
  retentionDays?: number;
}): Promise<SaveInquiryOutcome> {
  const {
    db,
    idempotencyKey,
    payloadHash,
    input,
    now = new Date(),
    retentionDays = 365,
  } = params;

  const inquiryId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const receiptId = generateReceiptId();
  const nowIso = now.toISOString();
  const retentionUntilIso = computeRetentionUntilIso(now, retentionDays);

  const insertInquiry = db
    .prepare(
      `INSERT INTO inquiries (
        id,
        receipt_id,
        idempotency_key,
        payload_hash,
        category,
        service,
        context,
        name,
        email,
        message,
        organization,
        phone,
        reference,
        privacy_version,
        privacy_accepted_at,
        created_at,
        retention_until
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
      )`
    )
    .bind(
      inquiryId,
      receiptId,
      idempotencyKey,
      payloadHash,
      input.category,
      input.service,
      input.context,
      input.name,
      input.email,
      input.message,
      input.organization,
      input.phone,
      input.reference,
      input.privacyVersion,
      nowIso,
      nowIso,
      retentionUntilIso
    );

  const insertJob = db
    .prepare(
      `INSERT INTO notification_jobs (
        id,
        inquiry_id,
        kind,
        status,
        attempts,
        next_attempt_at,
        lease_token,
        lease_until,
        provider_message_id,
        last_error_code,
        created_at,
        updated_at,
        sent_at
      ) VALUES (
        ?1, ?2, 'operator_notification', 'pending', 0, ?3, NULL, NULL, NULL, NULL, ?3, ?3, NULL
      )`
    )
    .bind(jobId, inquiryId, nowIso);

  try {
    await db.batch([insertInquiry, insertJob]);
    return {
      status: "created",
      inquiryId,
      jobId,
      receiptId,
      receivedAt: nowIso,
    };
  } catch {
    // Re-read in case of concurrent UNIQUE conflict on idempotency_key (Section 9.2 Step 5)
    try {
      const existing = await findInquiryByIdempotencyKey(db, idempotencyKey);
      if (existing) {
        if (existing.payload_hash === payloadHash) {
          return {
            status: "duplicate_accepted",
            inquiryId: existing.id,
            receiptId: existing.receipt_id,
            receivedAt: existing.created_at,
          };
        }
        return {
          status: "conflict",
        };
      }
    } catch {
      // Fall through to db_error
    }
    return {
      status: "db_error",
    };
  }
}

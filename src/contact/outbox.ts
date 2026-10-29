/**
 * Outbox processor for operator notification emails with lease locking and exponential backoff.
 * Conforms to Section 9.3 of the specification.
 */

import {
  type CloudflareEmailBinding,
  type InquiryRecordForEmail,
  sendContactNotification,
} from "./email.ts";
import type { D1DatabaseLike } from "./storage.ts";

export const LEASE_DURATION_SECONDS = 120;
export const MAX_BATCH_JOBS = 20;

/**
 * Initial attempt (attempt 1) + up to 5 retries (attempts 2..6).
 * Wait durations after attempt N fails:
 * Attempt 1 -> 1 min (60s)
 * Attempt 2 -> 5 min (300s)
 * Attempt 3 -> 15 min (900s)
 * Attempt 4 -> 60 min (3600s)
 * Attempt 5 -> 180 min (10800s)
 * Attempt 6 -> permanent 'failed'
 */
export const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 10800] as const;
export const MAX_TOTAL_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1; // 6

export interface NotificationJobRow {
  id: string;
  inquiry_id: string;
  kind: string;
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number;
  next_attempt_at: string;
  lease_token: string | null;
  lease_until: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface ProcessJobResult {
  jobId: string;
  outcome: "sent" | "retrying" | "failed" | "skipped_not_acquired" | "missing_inquiry";
  attempts?: number;
  errorCode?: string;
}

export async function acquireJobLease(params: {
  db: D1DatabaseLike;
  jobId: string;
  now: Date;
  leaseSeconds?: number;
}): Promise<string | null> {
  const { db, jobId, now, leaseSeconds = LEASE_DURATION_SECONDS } = params;
  const nowIso = now.toISOString();
  const leaseUntilIso = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const leaseToken = crypto.randomUUID();

  const res = await db
    .prepare(
      `UPDATE notification_jobs
       SET status = 'processing',
           lease_token = ?1,
           lease_until = ?2,
           updated_at = ?3
       WHERE id = ?4
         AND (
           (status = 'pending' AND next_attempt_at <= ?3)
           OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?3)
         )`
    )
    .bind(leaseToken, leaseUntilIso, nowIso, jobId)
    .run();

  const changes = res.meta?.changes ?? 0;
  return changes > 0 ? leaseToken : null;
}

export async function processSingleNotificationJob(params: {
  db: D1DatabaseLike;
  jobId: string;
  fromAddress: string | undefined;
  toAddress: string | undefined;
  emailBinding: CloudflareEmailBinding | undefined;
  now?: Date;
}): Promise<ProcessJobResult> {
  const {
    db,
    jobId,
    fromAddress,
    toAddress,
    emailBinding,
    now = new Date(),
  } = params;

  const leaseToken = await acquireJobLease({ db, jobId, now });
  if (!leaseToken) {
    return {
      jobId,
      outcome: "skipped_not_acquired",
    };
  }

  const jobRow = await db
    .prepare(
      `SELECT id, inquiry_id, attempts
       FROM notification_jobs
       WHERE id = ?1 AND status = 'processing' AND lease_token = ?2`
    )
    .bind(jobId, leaseToken)
    .first<{ id: string; inquiry_id: string; attempts: number }>();

  if (!jobRow) {
    return {
      jobId,
      outcome: "skipped_not_acquired",
    };
  }

  const inquiry = await db
    .prepare(
      `SELECT id, receipt_id, category, service, context, name, email, message, organization, phone, reference, created_at
       FROM inquiries
       WHERE id = ?1`
    )
    .bind(jobRow.inquiry_id)
    .first<InquiryRecordForEmail>();

  const finishNow = new Date();
  const finishNowIso = finishNow.toISOString();
  const currentAttempt = (jobRow.attempts ?? 0) + 1;

  if (!inquiry) {
    await db
      .prepare(
        `UPDATE notification_jobs
         SET status = 'failed',
             attempts = ?1,
             lease_token = NULL,
             lease_until = NULL,
             last_error_code = 'INQUIRY_NOT_FOUND',
             updated_at = ?2
         WHERE id = ?3 AND status = 'processing' AND lease_token = ?4`
      )
      .bind(currentAttempt, finishNowIso, jobId, leaseToken)
      .run();

    return {
      jobId,
      outcome: "missing_inquiry",
      attempts: currentAttempt,
      errorCode: "INQUIRY_NOT_FOUND",
    };
  }

  const sendResult = await sendContactNotification({
    inquiry,
    fromAddress,
    toAddress,
    emailBinding,
  });

  if (sendResult.ok) {
    await db
      .prepare(
        `UPDATE notification_jobs
         SET status = 'sent',
             attempts = ?1,
             lease_token = NULL,
             lease_until = NULL,
             provider_message_id = ?2,
             last_error_code = NULL,
             sent_at = ?3,
             updated_at = ?3
         WHERE id = ?4 AND status = 'processing' AND lease_token = ?5`
      )
      .bind(currentAttempt, sendResult.messageId, finishNowIso, jobId, leaseToken)
      .run();

    return {
      jobId,
      outcome: "sent",
      attempts: currentAttempt,
    };
  }

  // Handle failure: permanent error or max attempts reached -> 'failed'
  const isExhausted = currentAttempt >= MAX_TOTAL_ATTEMPTS;
  if (sendResult.permanent || isExhausted) {
    await db
      .prepare(
        `UPDATE notification_jobs
         SET status = 'failed',
             attempts = ?1,
             lease_token = NULL,
             lease_until = NULL,
             last_error_code = ?2,
             updated_at = ?3
         WHERE id = ?4 AND status = 'processing' AND lease_token = ?5`
      )
      .bind(currentAttempt, sendResult.errorCode, finishNowIso, jobId, leaseToken)
      .run();

    return {
      jobId,
      outcome: "failed",
      attempts: currentAttempt,
      errorCode: sendResult.errorCode,
    };
  }

  // Transient error: schedule next retry
  const scheduleDelay = RETRY_DELAYS_SECONDS[currentAttempt - 1] ?? 10800;
  const effectiveDelaySeconds = sendResult.retryAfterSeconds
    ? Math.max(scheduleDelay, sendResult.retryAfterSeconds)
    : scheduleDelay;
  const nextAttemptAtIso = new Date(
    now.getTime() + effectiveDelaySeconds * 1000
  ).toISOString();

  await db
    .prepare(
      `UPDATE notification_jobs
       SET status = 'pending',
           attempts = ?1,
           next_attempt_at = ?2,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = ?3,
           updated_at = ?4
       WHERE id = ?5 AND status = 'processing' AND lease_token = ?6`
    )
    .bind(
      currentAttempt,
      nextAttemptAtIso,
      sendResult.errorCode,
      finishNowIso,
      jobId,
      leaseToken
    )
    .run();

  return {
    jobId,
    outcome: "retrying",
    attempts: currentAttempt,
    errorCode: sendResult.errorCode,
  };
}

export async function processDueNotificationJobs(params: {
  db: D1DatabaseLike;
  fromAddress: string | undefined;
  toAddress: string | undefined;
  emailBinding: CloudflareEmailBinding | undefined;
  now?: Date;
  limit?: number;
}): Promise<ProcessJobResult[]> {
  const {
    db,
    fromAddress,
    toAddress,
    emailBinding,
    now = new Date(),
    limit = MAX_BATCH_JOBS,
  } = params;

  const nowIso = now.toISOString();
  const candidates = await db
    .prepare(
      `SELECT id
       FROM notification_jobs
       WHERE (status = 'pending' AND next_attempt_at <= ?1)
          OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?1)
       ORDER BY next_attempt_at ASC
       LIMIT ?2`
    )
    .bind(nowIso, limit)
    .all<{ id: string }>();

  const results: ProcessJobResult[] = [];
  for (const row of candidates.results ?? []) {
    const res = await processSingleNotificationJob({
      db,
      jobId: row.id,
      fromAddress,
      toAddress,
      emailBinding,
      now,
    });
    results.push(res);
  }

  return results;
}

/**
 * Cloudflare Worker entrypoint for AI Orchestration LP.
 * Handles POST /api/contact, 404 for unknown /api/*, static asset fallback, and scheduled Outbox retry.
 */

import type { CloudflareEmailBinding } from "./contact/email.ts";
import {
  processDueNotificationJobs,
  processSingleNotificationJob,
} from "./contact/outbox.ts";
import {
  MAX_BODY_BYTES,
  computePayloadHash,
  isValidIdempotencyKey,
  validateContactPayload,
} from "./contact/schema.ts";
import {
  type D1DatabaseLike,
  checkRateLimit,
  cleanupExpiredRateLimits,
  computeIpHash,
  findInquiryByIdempotencyKey,
  saveInquiryWithOutboxJob,
} from "./contact/storage.ts";
import {
  extractAllowedHostnames,
  verifyTurnstileToken,
} from "./contact/turnstile.ts";

export interface Env {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  DB?: D1DatabaseLike;
  EMAIL?: CloudflareEmailBinding;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  CONTACT_FROM?: string;
  CONTACT_TO?: string;
  ALLOWED_ORIGINS?: string;
  IP_HASH_SECRET?: string;
  CONTACT_ENABLED?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RETENTION_DAYS?: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
  scheduledTime?: number;
  cron?: string;
}

export interface WorkerDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!raw) return set;
  for (const item of raw.split(",")) {
    const trimmed = item.trim();
    if (trimmed) {
      set.add(trimmed);
    }
  }
  return set;
}

async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; reason: "too_large" | "read_error" }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: "too_large" };
    }
  }

  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel error
          }
          return { ok: false, reason: "too_large" };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, reason: "read_error" };
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
  return { ok: true, text };
}

export async function handleContactRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContextLike,
  deps: WorkerDependencies = {}
): Promise<Response> {
  const nowFn = deps.now ?? (() => new Date());

  // 1. Method check
  if (request.method !== "POST") {
    return jsonResponse(
      {
        status: "method_not_allowed",
        code: "method_not_allowed",
        message: "POSTメソッドのみ受け付けています。",
      },
      405,
      { Allow: "POST" }
    );
  }

  // 2. Feature switch & DB availability check
  const enabledFlag = (env.CONTACT_ENABLED ?? "true").trim().toLowerCase();
  if (enabledFlag === "false" || enabledFlag === "0" || !env.DB) {
    return jsonResponse(
      {
        status: "temporarily_unavailable",
        code: "temporarily_unavailable",
        message: "現在フォームからの受付を一時停止しています。時間をおいてお試しください。",
      },
      503
    );
  }

  // 3. Exact Origin verification (no wildcard CORS)
  const origin = request.headers.get("origin")?.trim() ?? "";
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (!origin || allowedOrigins.size === 0 || !allowedOrigins.has(origin)) {
    return jsonResponse(
      {
        status: "verification_failed",
        code: "verification_failed",
        message: "送信元の確認ができませんでした。",
      },
      403
    );
  }

  // 4. Content-Type check
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonResponse(
      {
        status: "unsupported_media_type",
        code: "unsupported_media_type",
        message: "Content-Type は application/json を指定してください。",
      },
      415
    );
  }

  // 5. Payload size check (32 KiB max)
  const bodyRead = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    if (bodyRead.reason === "too_large") {
      return jsonResponse(
        {
          status: "payload_too_large",
          code: "payload_too_large",
          message: "送信データの上限を超えています。",
        },
        413
      );
    }
    return jsonResponse(
      {
        status: "invalid_request",
        code: "invalid_request",
        message: "リクエスト本文を読み取れませんでした。",
      },
      400
    );
  }

  // 6. Idempotency-Key header check
  const rawIdempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!isValidIdempotencyKey(rawIdempotencyKey)) {
    return jsonResponse(
      {
        status: "invalid_request",
        code: "invalid_request",
        message: "Idempotency-Key が不正です。",
      },
      400
    );
  }
  const idempotencyKey = rawIdempotencyKey.toLowerCase();

  // 7. Short-term IP rate limiting (HMAC-SHA256 in D1, never storing raw IP)
  const clientIp =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0";
  const maxRequests = Math.max(1, Number(env.RATE_LIMIT_MAX || "10") || 10);
  const windowSeconds = Math.max(10, Number(env.RATE_LIMIT_WINDOW_SECONDS || "600") || 600);

  try {
    const ipHash = await computeIpHash(clientIp, env.IP_HASH_SECRET ?? "");
    const rate = await checkRateLimit({
      db: env.DB,
      ipHash,
      nowMs: nowFn().getTime(),
      windowSeconds,
      maxRequests,
    });
    if (!rate.allowed) {
      return jsonResponse(
        {
          status: "rate_limited",
          code: "rate_limited",
          message: "短時間に送信が続いています。少し時間をおいてお試しください。",
          retryAfterSeconds: rate.retryAfterSeconds,
        },
        429,
        { "Retry-After": String(rate.retryAfterSeconds) }
      );
    }
  } catch {
    return jsonResponse(
      {
        status: "temporarily_unavailable",
        code: "temporarily_unavailable",
        message: "送信を完了できませんでした。時間をおいて、もう一度お試しください。",
      },
      503
    );
  }

  // 8. Parse and validate JSON payload
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyRead.text);
  } catch {
    return jsonResponse(
      {
        status: "invalid_request",
        code: "invalid_request",
        message: "JSON形式が不正です。",
      },
      400
    );
  }

  const validation = validateContactPayload(parsedJson);
  if (!validation.ok) {
    return jsonResponse(
      {
        status: validation.code,
        code: validation.code,
        message: validation.message,
        ...(validation.fieldErrors ? { fieldErrors: validation.fieldErrors } : {}),
      },
      validation.status
    );
  }

  const normalizedInput = validation.data;
  const payloadHash = await computePayloadHash(normalizedInput);

  // 9. Idempotency check BEFORE Turnstile verification (Section 9.2 Step 2 & 3)
  // Allows safe retry when previous response was lost even if single-use Turnstile token is now spent.
  try {
    const existing = await findInquiryByIdempotencyKey(env.DB, idempotencyKey);
    if (existing) {
      if (existing.payload_hash === payloadHash) {
        return jsonResponse(
          {
            status: "accepted",
            receiptId: existing.receipt_id,
            receivedAt: existing.created_at,
          },
          200
        );
      }
      return jsonResponse(
        {
          status: "idempotency_conflict",
          code: "idempotency_conflict",
          message: "同じ送信キーで異なる内容が送信されました。もう一度送信してください。",
        },
        409
      );
    }
  } catch {
    return jsonResponse(
      {
        status: "temporarily_unavailable",
        code: "temporarily_unavailable",
        message: "送信を完了できませんでした。時間をおいて、もう一度お試しください。",
      },
      503
    );
  }

  // 10. Turnstile server-side verification for new inquiry (Section 9.2 Step 4)
  const allowedHostnames = extractAllowedHostnames(env.ALLOWED_ORIGINS);
  const turnstileResult = await verifyTurnstileToken({
    token: normalizedInput.turnstileToken,
    secretKey: env.TURNSTILE_SECRET_KEY,
    remoteIp: clientIp !== "0.0.0.0" ? clientIp : undefined,
    idempotencyKey,
    allowedHostnames,
    fetchImpl: deps.fetchImpl,
  });

  if (!turnstileResult.ok) {
    if (turnstileResult.status === 503) {
      return jsonResponse(
        {
          status: "temporarily_unavailable",
          code: "temporarily_unavailable",
          message: "確認サービスへ接続できませんでした。時間をおいて、もう一度お試しください。",
        },
        503
      );
    }
    return jsonResponse(
      {
        status: "verification_failed",
        code: "verification_failed",
        message: "不正送信防止の確認ができませんでした。もう一度確認して送信してください。",
      },
      403
    );
  }

  // 11. Save inquiry + notification job atomically via D1 batch()
  const retentionDays = Math.max(1, Number(env.RETENTION_DAYS || "365") || 365);
  const now = nowFn();
  const saveOutcome = await saveInquiryWithOutboxJob({
    db: env.DB,
    idempotencyKey,
    payloadHash,
    input: normalizedInput,
    now,
    retentionDays,
  });

  if (saveOutcome.status === "conflict") {
    return jsonResponse(
      {
        status: "idempotency_conflict",
        code: "idempotency_conflict",
        message: "同じ送信キーで異なる内容が送信されました。もう一度送信してください。",
      },
      409
    );
  }

  if (saveOutcome.status === "db_error") {
    return jsonResponse(
      {
        status: "temporarily_unavailable",
        code: "temporarily_unavailable",
        message: "送信を完了できませんでした。時間をおいて、もう一度お試しください。",
      },
      503
    );
  }

  if (saveOutcome.status === "duplicate_accepted") {
    return jsonResponse(
      {
        status: "accepted",
        receiptId: saveOutcome.receiptId,
        receivedAt: saveOutcome.receivedAt,
      },
      200
    );
  }

  // 12. Newly saved (201). Trigger immediate notification attempt without failing the HTTP response.
  const notifyPromise = processSingleNotificationJob({
    db: env.DB,
    jobId: saveOutcome.jobId,
    fromAddress: env.CONTACT_FROM,
    toAddress: env.CONTACT_TO,
    emailBinding: env.EMAIL,
    now: nowFn(),
  }).catch(() => {
    // Persistent notification_jobs record remains the source of truth for scheduled retry.
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(notifyPromise);
  } else {
    await notifyPromise;
  }

  return jsonResponse(
    {
      status: "accepted",
      receiptId: saveOutcome.receiptId,
      receivedAt: saveOutcome.receivedAt,
    },
    201
  );
}

export function createWorkerHandler(deps: WorkerDependencies = {}) {
  return {
    async fetch(
      request: Request,
      env: Env,
      ctx?: ExecutionContextLike
    ): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/api/contact") {
        return await handleContactRequest(request, env, ctx, deps);
      }

      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return jsonResponse(
          {
            status: "not_found",
            code: "not_found",
            message: "指定されたAPIエンドポイントは存在しません。",
          },
          404
        );
      }

      if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
        return await env.ASSETS.fetch(request);
      }

      return new Response("Not Found", { status: 404 });
    },

    async scheduled(
      _controller: ScheduledControllerLike,
      env: Env,
      ctx?: ExecutionContextLike
    ): Promise<void> {
      if (!env.DB) return;
      const now = deps.now ? deps.now() : new Date();
      const work = (async () => {
        await processDueNotificationJobs({
          db: env.DB!,
          fromAddress: env.CONTACT_FROM,
          toAddress: env.CONTACT_TO,
          emailBinding: env.EMAIL,
          now,
        });
        await cleanupExpiredRateLimits(env.DB!, now.toISOString());
      })();

      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(work);
      } else {
        await work;
      }
    },
  };
}

const defaultWorker = createWorkerHandler();
export default defaultWorker;

/**
 * Automated tests for Contact API (API-01 through API-07).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkerHandler, type Env } from "../../src/worker.ts";
import { createTestD1 } from "./d1-sqlite-helper.ts";

const VALID_ORIGIN = "https://ai-orchestration.jp";
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    category: "business",
    service: "general",
    organization: "サンプル株式会社",
    name: "山田 太郎",
    email: "Taro.Yamada+test@Example.COM",
    message: "現在の業務にAIを取り入れる方法を相談したいです。",
    reference: "",
    phone: "03-1234-5678",
    privacyAccepted: true,
    privacyVersion: "contact-2026-10-29",
    context: "home",
    turnstileToken: "valid-turnstile-token",
    website: "",
    ...overrides,
  };
}

function makeTurnstileFetch(options?: {
  success?: boolean;
  hostname?: string;
  action?: string;
  errorCodes?: string[];
  httpStatus?: number;
  onCall?: () => void;
}): typeof fetch {
  return async () => {
    options?.onCall?.();
    const status = options?.httpStatus ?? 200;
    const body = {
      success: options?.success ?? true,
      hostname: options?.hostname ?? "ai-orchestration.jp",
      action: options?.action ?? "contact",
      "error-codes": options?.errorCodes ?? [],
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function makeBaseEnv(dbController = createTestD1()): {
  env: Env;
  dbController: ReturnType<typeof createTestD1>;
  sentEmails: unknown[];
} {
  const sentEmails: unknown[] = [];
  const env: Env = {
    DB: dbController.db,
    EMAIL: {
      async send(msg) {
        sentEmails.push(msg);
        return { messageId: `msg-${sentEmails.length}` };
      },
    },
    TURNSTILE_SECRET_KEY: "test-secret-key",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    CONTACT_FROM: "AI Orchestration フォーム通知 <notify@ai-orchestration.jp>",
    CONTACT_TO: "support@ai-orchestration.jp",
    ALLOWED_ORIGINS: "https://ai-orchestration.jp,http://localhost:8787",
    IP_HASH_SECRET: "unit-test-hmac-secret",
    CONTACT_ENABLED: "true",
    RATE_LIMIT_MAX: "10",
    RATE_LIMIT_WINDOW_SECONDS: "600",
    RETENTION_DAYS: "365",
  };
  return { env, dbController, sentEmails };
}

describe("Contact API Contract & Verification (API-01 to API-07)", () => {
  it("API-01: accepts valid request, preserves email local-part case, lowercases domain, and stores inquiry + job", async () => {
    const { env, dbController, sentEmails } = makeBaseEnv();
    const worker = createWorkerHandler({
      fetchImpl: makeTurnstileFetch(),
    });

    const req = new Request("https://ai-orchestration.jp/api/contact", {
      method: "POST",
      headers: {
        Origin: VALID_ORIGIN,
        "Content-Type": "application/json",
        "Idempotency-Key": VALID_UUID,
        "CF-Connecting-IP": "203.0.113.10",
      },
      body: JSON.stringify(makeValidPayload()),
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("Cache-Control"), "no-store");

    const data = (await res.json()) as {
      status: string;
      receiptId: string;
      receivedAt: string;
    };
    assert.equal(data.status, "accepted");
    assert.match(data.receiptId, /^AIO-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
    assert.ok(Date.parse(data.receivedAt) > 0);

    // Verify stored inquiry in D1
    const stored = dbController.rawDb
      .prepare("SELECT * FROM inquiries WHERE idempotency_key = ?")
      .get(VALID_UUID) as Record<string, unknown>;
    assert.ok(stored);
    assert.equal(stored.receipt_id, data.receiptId);
    // Local part case preserved, domain lowercased
    assert.equal(stored.email, "Taro.Yamada+test@example.com");

    // Verify notification job was created and sent
    const job = dbController.rawDb
      .prepare("SELECT * FROM notification_jobs WHERE inquiry_id = ?")
      .get(stored.id as string) as Record<string, unknown>;
    assert.ok(job);
    assert.equal(job.status, "sent");
    assert.equal(sentEmails.length, 1);
  });

  it("API-01: enforces required fields, type strictness (no coercion), lengths, enums, and honeypot", async () => {
    const { env } = makeBaseEnv();
    const worker = createWorkerHandler({
      fetchImpl: makeTurnstileFetch(),
    });

    const sendPayload = async (payload: unknown, key = crypto.randomUUID()) => {
      return await worker.fetch(
        new Request("https://ai-orchestration.jp/api/contact", {
          method: "POST",
          headers: {
            Origin: VALID_ORIGIN,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(payload),
        }),
        env
      );
    };

    // 1. String "true" for privacyAccepted must NOT be coerced to boolean true -> 400
    const resCoerce = await sendPayload(
      makeValidPayload({ privacyAccepted: "true" })
    );
    assert.equal(resCoerce.status, 400);

    // 2. Unknown property -> 400
    const resUnknownKey = await sendPayload(
      makeValidPayload({ extraField: "not-allowed" })
    );
    assert.equal(resUnknownKey.status, 400);

    // 3. Honeypot non-empty -> 400
    const resHoneypot = await sendPayload(
      makeValidPayload({ website: "https://spam.example.com" })
    );
    assert.equal(resHoneypot.status, 400);

    // 4. CR/LF in header field -> 400
    const resCrLf = await sendPayload(
      makeValidPayload({ name: "山田\r\nBcc: victim@example.com" })
    );
    assert.equal(resCrLf.status, 400);

    // 5. Invalid enum -> 400
    const resBadEnum = await sendPayload(
      makeValidPayload({ category: "unknown_category" })
    );
    assert.equal(resBadEnum.status, 400);

    // 6. Missing required fields & invalid email -> 422 with fieldErrors
    const resValidation = await sendPayload(
      makeValidPayload({
        category: "",
        name: "   ",
        email: "invalid-email@",
        message: "   \n  ",
        privacyAccepted: false,
      })
    );
    assert.equal(resValidation.status, 422);
    const valBody = (await resValidation.json()) as {
      code: string;
      fieldErrors: Record<string, string>;
    };
    assert.equal(valBody.code, "validation_error");
    assert.ok(valBody.fieldErrors.category);
    assert.ok(valBody.fieldErrors.name);
    assert.ok(valBody.fieldErrors.email);
    assert.ok(valBody.fieldErrors.message);
    assert.ok(valBody.fieldErrors.privacyAccepted);

    // 7. Unicode code point length check (5001 emojis = 5001 code points > 5000)
    const resTooLongMsg = await sendPayload(
      makeValidPayload({
        message: "あ".repeat(5001),
      })
    );
    assert.equal(resTooLongMsg.status, 422);
    const longBody = (await resTooLongMsg.json()) as {
      fieldErrors: Record<string, string>;
    };
    assert.ok(longBody.fieldErrors.message);

    // 8. Category-service correspondence: product requires specific service (not general/empty)
    const resProductNoService = await sendPayload(
      makeValidPayload({
        category: "product",
        service: "general",
      })
    );
    assert.equal(resProductNoService.status, 422);
  });

  it("API-02: rolls back both inquiry and notification job when D1 batch fails mid-transaction", async () => {
    const { env, dbController } = makeBaseEnv();
    dbController.failOnSecondBatchStatement = true;

    const worker = createWorkerHandler({
      fetchImpl: makeTurnstileFetch(),
    });

    const req = new Request("https://ai-orchestration.jp/api/contact", {
      method: "POST",
      headers: {
        Origin: VALID_ORIGIN,
        "Content-Type": "application/json",
        "Idempotency-Key": VALID_UUID,
      },
      body: JSON.stringify(makeValidPayload()),
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 503);

    const inquiryCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM inquiries")
      .get() as { cnt: number };
    const jobCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM notification_jobs")
      .get() as { cnt: number };

    assert.equal(inquiryCount.cnt, 0);
    assert.equal(jobCount.cnt, 0);
  });

  it("API-03 & API-06: retrying with same Idempotency-Key and same body returns 200 with same receiptId without re-running Turnstile or duplicating rows", async () => {
    const { env, dbController } = makeBaseEnv();
    let turnstileCalls = 0;

    // First call Turnstile succeeds; second call Turnstile would fail if called (simulating spent single-use token)
    const worker = createWorkerHandler({
      fetchImpl: async () => {
        turnstileCalls++;
        if (turnstileCalls === 1) {
          return new Response(
            JSON.stringify({
              success: true,
              hostname: "ai-orchestration.jp",
              action: "contact",
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["timeout-or-duplicate"],
          }),
          { status: 200 }
        );
      },
    });

    const payload = makeValidPayload();
    const makeReq = () =>
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": VALID_UUID,
        },
        body: JSON.stringify(payload),
      });

    const res1 = await worker.fetch(makeReq(), env);
    assert.equal(res1.status, 201);
    const body1 = (await res1.json()) as { receiptId: string; receivedAt: string };

    // Retry with same key and same body (even if client refreshed Turnstile token)
    const res2 = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": VALID_UUID,
        },
        body: JSON.stringify({ ...payload, turnstileToken: "expired-or-spent-token" }),
      }),
      env
    );

    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as { receiptId: string; receivedAt: string };
    assert.equal(body2.receiptId, body1.receiptId);
    assert.equal(body2.receivedAt, body1.receivedAt);
    assert.equal(turnstileCalls, 1);

    const inquiryCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM inquiries")
      .get() as { cnt: number };
    const jobCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM notification_jobs")
      .get() as { cnt: number };
    assert.equal(inquiryCount.cnt, 1);
    assert.equal(jobCount.cnt, 1);
  });

  it("API-04: concurrent requests with the same Idempotency-Key do not duplicate inquiry or notification job", async () => {
    const { env, dbController } = makeBaseEnv();
    const worker = createWorkerHandler({
      fetchImpl: makeTurnstileFetch(),
    });

    const payload = makeValidPayload();
    const makeReq = () =>
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": VALID_UUID,
        },
        body: JSON.stringify(payload),
      });

    const [r1, r2] = await Promise.all([
      worker.fetch(makeReq(), env),
      worker.fetch(makeReq(), env),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.ok(
      (statuses[0] === 200 && statuses[1] === 201) ||
        (statuses[0] === 201 && statuses[1] === 201)
    );

    const b1 = (await r1.json()) as { receiptId: string };
    const b2 = (await r2.json()) as { receiptId: string };
    assert.equal(b1.receiptId, b2.receiptId);

    const inquiryCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM inquiries")
      .get() as { cnt: number };
    const jobCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM notification_jobs")
      .get() as { cnt: number };
    assert.equal(inquiryCount.cnt, 1);
    assert.equal(jobCount.cnt, 1);
  });

  it("API-05: returns 409 idempotency_conflict when same Idempotency-Key is reused with modified message", async () => {
    const { env, dbController } = makeBaseEnv();
    const worker = createWorkerHandler({
      fetchImpl: makeTurnstileFetch(),
    });

    const res1 = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": VALID_UUID,
        },
        body: JSON.stringify(makeValidPayload({ message: "最初の本文です。" })),
      }),
      env
    );
    assert.equal(res1.status, 201);

    const res2 = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": VALID_UUID,
        },
        body: JSON.stringify(makeValidPayload({ message: "変更された本文です。" })),
      }),
      env
    );
    assert.equal(res2.status, 409);

    const stored = dbController.rawDb
      .prepare("SELECT message FROM inquiries WHERE idempotency_key = ?")
      .get(VALID_UUID) as { message: string };
    assert.equal(stored.message, "最初の本文です。");
  });

  it("API-06: rejects forged, expired, wrong-hostname, or wrong-action Turnstile tokens for unsaved submissions", async () => {
    const { env, dbController } = makeBaseEnv();

    for (const badCase of [
      { success: false, errorCodes: ["invalid-input-response"] },
      { success: true, hostname: "evil.example.com", action: "contact" },
      { success: true, hostname: "ai-orchestration.jp", action: "login" },
    ]) {
      const worker = createWorkerHandler({
        fetchImpl: makeTurnstileFetch(badCase),
      });

      const res = await worker.fetch(
        new Request("https://ai-orchestration.jp/api/contact", {
          method: "POST",
          headers: {
            Origin: VALID_ORIGIN,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(makeValidPayload()),
        }),
        env
      );
      assert.equal(res.status, 403);
    }

    const inquiryCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM inquiries")
      .get() as { cnt: number };
    assert.equal(inquiryCount.cnt, 0);

    // Test official Cloudflare dummy testing key response (hostname: example.com, no action, metadata.result_with_testing_key: true)
    const testKeyWorker = createWorkerHandler({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: true,
            hostname: "example.com",
            metadata: { result_with_testing_key: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });
    const testKeyRes = await testKeyWorker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(makeValidPayload()),
      }),
      env
    );
    assert.equal(testKeyRes.status, 201);
  });

  it("API-07: rejects wrong Origin (403), oversized body (413), non-JSON (415), rate-limited IPs (429), and unknown /api/* (404)", async () => {
    const { env, dbController } = makeBaseEnv();
    env.RATE_LIMIT_MAX = "2";
    const worker = createWorkerHandler({
      fetchImpl: makeTurnstileFetch(),
    });

    // 1. Wrong Origin -> 403
    const resOrigin = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: "https://attacker.example.com",
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(makeValidPayload()),
      }),
      env
    );
    assert.equal(resOrigin.status, 403);

    // 2. Non-JSON Content-Type -> 415
    const resMedia = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "text/plain",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: "plain text",
      }),
      env
    );
    assert.equal(resMedia.status, 415);

    // 3. Payload > 32 KiB -> 413
    const hugeBody = JSON.stringify(
      makeValidPayload({ message: "A".repeat(35000) })
    );
    const resHuge = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", {
        method: "POST",
        headers: {
          Origin: VALID_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: hugeBody,
      }),
      env
    );
    assert.equal(resHuge.status, 413);

    // 4. Rate limit (max 2 requests per window from same IP)
    const sendFromIp = () =>
      worker.fetch(
        new Request("https://ai-orchestration.jp/api/contact", {
          method: "POST",
          headers: {
            Origin: VALID_ORIGIN,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "CF-Connecting-IP": "198.51.100.77",
          },
          body: JSON.stringify(makeValidPayload()),
        }),
        env
      );

    const r1 = await sendFromIp();
    assert.equal(r1.status, 201);
    const r2 = await sendFromIp();
    assert.equal(r2.status, 201);
    const r3 = await sendFromIp();
    assert.equal(r3.status, 429);
    assert.ok(Number(r3.headers.get("Retry-After")) > 0);

    // Ensure only 2 inquiries were saved
    const inquiryCount = dbController.rawDb
      .prepare("SELECT COUNT(*) as cnt FROM inquiries")
      .get() as { cnt: number };
    assert.equal(inquiryCount.cnt, 2);

    // 5. Unknown /api/* returns 404 JSON, GET /api/contact returns 405 JSON
    const res404 = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/unknown"),
      env
    );
    assert.equal(res404.status, 404);
    assert.match(res404.headers.get("Content-Type") || "", /application\/json/);

    const res405 = await worker.fetch(
      new Request("https://ai-orchestration.jp/api/contact", { method: "GET" }),
      env
    );
    assert.equal(res405.status, 405);
  });
});

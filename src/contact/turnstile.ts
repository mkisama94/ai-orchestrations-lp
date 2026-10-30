/**
 * Cloudflare Turnstile server-side verification (Siteverify).
 */

export interface TurnstileVerifyParams {
  token: string;
  secretKey: string | undefined;
  remoteIp?: string | null;
  idempotencyKey?: string;
  allowedHostnames: Set<string>;
  fetchImpl?: typeof fetch;
}

export type TurnstileVerifyResult =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 503;
      code: "verification_failed" | "temporarily_unavailable";
      reason: string;
    };

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
  metadata?: {
    result_with_testing_key?: boolean;
  };
}

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function extractAllowedHostnames(allowedOriginsRaw: string | undefined): Set<string> {
  const hostnames = new Set<string>();
  if (!allowedOriginsRaw) return hostnames;
  for (const part of allowedOriginsRaw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.hostname) {
        hostnames.add(url.hostname.toLowerCase());
      }
    } catch {
      // Ignore malformed origin entries
    }
  }
  return hostnames;
}

export async function verifyTurnstileToken(
  params: TurnstileVerifyParams
): Promise<TurnstileVerifyResult> {
  const {
    token,
    secretKey,
    remoteIp,
    idempotencyKey,
    allowedHostnames,
    fetchImpl = fetch,
  } = params;

  if (!secretKey || !secretKey.trim()) {
    return {
      ok: false,
      status: 503,
      code: "temporarily_unavailable",
      reason: "missing_secret_key",
    };
  }

  if (!token || !token.trim()) {
    return {
      ok: false,
      status: 403,
      code: "verification_failed",
      reason: "missing_token",
    };
  }

  const form = new URLSearchParams();
  form.set("secret", secretKey.trim());
  form.set("response", token.trim());
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }
  if (idempotencyKey) {
    form.set("idempotency_key", idempotencyKey);
  }

  let response: Response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "temporarily_unavailable",
      reason: "siteverify_network_error",
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      status: 503,
      code: "temporarily_unavailable",
      reason: "siteverify_upstream_error",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 403,
      code: "verification_failed",
      reason: "siteverify_http_error",
    };
  }

  let body: SiteverifyResponse;
  try {
    body = (await response.json()) as SiteverifyResponse;
  } catch {
    return {
      ok: false,
      status: 503,
      code: "temporarily_unavailable",
      reason: "siteverify_invalid_json",
    };
  }

  if (body.success !== true) {
    const errorCodes = Array.isArray(body["error-codes"]) ? body["error-codes"] : [];
    if (errorCodes.includes("internal-error")) {
      return {
        ok: false,
        status: 503,
        code: "temporarily_unavailable",
        reason: "siteverify_internal_error",
      };
    }
    return {
      ok: false,
      status: 403,
      code: "verification_failed",
      reason: "token_rejected",
    };
  }

  const isTestingKey =
    body.metadata?.result_with_testing_key === true ||
    secretKey.trim() === "1x0000000000000000000000000000000AA";

  if (!isTestingKey) {
    if (body.action !== "contact") {
      return {
        ok: false,
        status: 403,
        code: "verification_failed",
        reason: "action_mismatch",
      };
    }

    const verifiedHost = typeof body.hostname === "string" ? body.hostname.toLowerCase() : "";
    if (!verifiedHost || (allowedHostnames.size > 0 && !allowedHostnames.has(verifiedHost))) {
      return {
        ok: false,
        status: 403,
        code: "verification_failed",
        reason: "hostname_mismatch",
      };
    }
  }

  return { ok: true };
}

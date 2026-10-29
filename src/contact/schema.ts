/**
 * Contact API input schema, normalization, validation, and canonical payload hashing.
 */

export const PRIVACY_VERSION = "contact-2026-10-29";
export const MAX_BODY_BYTES = 32 * 1024; // 32 KiB

export const CATEGORIES = [
  "business",
  "partnership",
  "product",
  "open_estimate",
  "security",
  "other",
] as const;
export type ContactCategory = (typeof CATEGORIES)[number];

export const SERVICES = [
  "general",
  "oshieai",
  "datacenter",
  "open_estimate",
  "other",
  "unknown",
] as const;
export type ContactService = (typeof SERVICES)[number];

export const CONTEXTS = ["home", "oshieai", "datacenter"] as const;
export type ContactContext = (typeof CONTEXTS)[number];

export const CATEGORY_LABELS: Record<ContactCategory, string> = {
  business: "事業・開発のご相談",
  partnership: "協業・パートナーシップ",
  product: "製品・サービスについて",
  open_estimate: "Open Estimateについて",
  security: "セキュリティに関する報告",
  other: "その他",
};

export const SERVICE_LABELS: Record<ContactService, string> = {
  general: "全般・共通基盤",
  oshieai: "教AI（おしえあい）",
  datacenter: "低環境負荷＆分散型AIデータセンター",
  open_estimate: "Open Estimate",
  other: "その他",
  unknown: "不明・未定",
};

export const CONTEXT_LABELS: Record<ContactContext, string> = {
  home: "トップページ (/#contact)",
  oshieai: "教AI 製品ページ (/products/oshieai/#contact)",
  datacenter: "AIデータセンター ページ (/ai-infra/datacenter/#contact)",
};

export interface NormalizedContactInput {
  schemaVersion: 1;
  category: ContactCategory;
  service: ContactService;
  organization: string | null;
  name: string;
  email: string;
  message: string;
  reference: string | null;
  phone: string | null;
  privacyAccepted: true;
  privacyVersion: string;
  context: ContactContext;
  turnstileToken: string;
}

export type ValidationResult =
  | {
      ok: true;
      data: NormalizedContactInput;
    }
  | {
      ok: false;
      status: 400 | 422;
      code: "invalid_request" | "validation_error";
      message: string;
      fieldErrors?: Record<string, string>;
    };

const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "category",
  "service",
  "organization",
  "name",
  "email",
  "message",
  "reference",
  "phone",
  "privacyAccepted",
  "privacyVersion",
  "context",
  "turnstileToken",
  "website",
]);

const PRODUCT_SERVICES = new Set<ContactService>([
  "oshieai",
  "datacenter",
  "other",
  "unknown",
]);

const SECURITY_SERVICES = new Set<ContactService>([
  "general",
  "oshieai",
  "datacenter",
  "open_estimate",
  "other",
  "unknown",
]);

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function hasCrLf(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

/**
 * Normalizes email by trimming and lowercasing only the domain part.
 * Preserves local-part case and allows '+' and standard RFC characters.
 */
export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return trimmed;
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1).toLowerCase();
  return `${local}@${domain}`;
}

export function isValidEmail(email: string): boolean {
  if (!email || codePointLength(email) > 254 || email.length > 254) {
    return false;
  }
  if (hasCrLf(email) || /\s/.test(email)) {
    return false;
  }
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return false;
  }
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!local || local.length > 64 || !domain || domain.length > 253) {
    return false;
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  // Allow standard unquoted local-part characters including '+'
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
    return false;
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || /^\d+$/.test(tld)) {
    return false;
  }
  return true;
}

export function isValidPhone(phone: string): boolean {
  if (codePointLength(phone) > 30) return false;
  if (hasCrLf(phone)) return false;
  // Allow digits, spaces, hyphens, plus, parentheses, dots
  if (!/^[0-9+\-() .　ー－]+$/.test(phone)) return false;
  const digitCount = (phone.match(/[0-9]/g) || []).length;
  return digitCount >= 6 && digitCount <= 20;
}

/**
 * Validates Idempotency-Key header: must be a valid UUID (v4 or standard 128-bit UUID).
 */
export function isValidIdempotencyKey(key: string | null | undefined): key is string {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    trimmed
  );
}

export function validateContactPayload(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "リクエスト形式が不正です。",
    };
  }

  const obj = raw as Record<string, unknown>;

  // Reject unknown keys
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        message: "不正なフィールドが含まれています。",
      };
    }
  }

  // Strict type checks (no coercion)
  if (obj.schemaVersion !== 1) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "スキーマバージョンが不正です。",
    };
  }

  if (typeof obj.website !== "string" || obj.website !== "") {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "リクエストを受け付けられませんでした。",
    };
  }

  if (typeof obj.privacyAccepted !== "boolean") {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "同意フラグの型が不正です。",
    };
  }

  const stringFields = [
    "category",
    "service",
    "name",
    "email",
    "message",
    "privacyVersion",
    "context",
    "turnstileToken",
  ] as const;

  for (const field of stringFields) {
    if (typeof obj[field] !== "string") {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        message: `${field} の型が不正です。`,
      };
    }
  }

  const optionalStringFields = ["organization", "reference", "phone"] as const;
  for (const field of optionalStringFields) {
    if (obj[field] !== undefined && obj[field] !== null && typeof obj[field] !== "string") {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        message: `${field} の型が不正です。`,
      };
    }
  }

  const rawCategory = (obj.category as string).trim();
  const rawService = (obj.service as string).trim();
  const rawContext = (obj.context as string).trim();
  const rawPrivacyVersion = (obj.privacyVersion as string).trim();
  const rawTurnstileToken = (obj.turnstileToken as string).trim();
  const rawName = (obj.name as string).trim();
  const rawEmail = normalizeEmail(obj.email as string);
  const rawOrganization = typeof obj.organization === "string" ? obj.organization.trim() : "";
  const rawReference = typeof obj.reference === "string" ? obj.reference.trim() : "";
  const rawPhone = typeof obj.phone === "string" ? obj.phone.trim() : "";
  const rawMessage = (obj.message as string).replace(/\r\n?/g, "\n").trim();

  // Reject CR/LF or null byte in single-line header/metadata fields
  const singleLineValues = [
    rawCategory,
    rawService,
    rawContext,
    rawPrivacyVersion,
    rawName,
    rawEmail,
    rawOrganization,
    rawReference,
    rawPhone,
  ];
  for (const val of singleLineValues) {
    if (hasCrLf(val)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        message: "不正な制御文字が含まれています。",
      };
    }
  }

  if (/\0/.test(rawMessage) || hasCrLf(rawTurnstileToken) || rawTurnstileToken.length > 4096) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "リクエスト形式が不正です。",
    };
  }

  if (!CONTEXTS.includes(rawContext as ContactContext)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "context が不正です。",
    };
  }

  if (
    !rawPrivacyVersion ||
    codePointLength(rawPrivacyVersion) > 64 ||
    !/^[A-Za-z0-9._-]+$/.test(rawPrivacyVersion)
  ) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "privacyVersion が不正です。",
    };
  }

  // If category or service has an arbitrary unknown value (not empty and not in enum), reject
  if (rawCategory !== "" && !CATEGORIES.includes(rawCategory as ContactCategory)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "ご相談の種別が不正です。",
    };
  }

  if (rawService !== "" && !SERVICES.includes(rawService as ContactService)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "対象のサービスが不正です。",
    };
  }

  // Field-level user validation (422)
  const fieldErrors: Record<string, string> = {};

  if (rawCategory === "") {
    fieldErrors.category = "ご相談の種別を選んでください";
  }

  const category = rawCategory as ContactCategory;
  let resolvedService: ContactService = "general";

  if (!fieldErrors.category) {
    if (category === "open_estimate") {
      if (rawService !== "" && rawService !== "open_estimate") {
        return {
          ok: false,
          status: 400,
          code: "invalid_request",
          message: "ご相談の種別と対象サービスの組み合わせが不正です。",
        };
      }
      resolvedService = "open_estimate";
    } else if (category === "product") {
      if (rawService === "" || rawService === "general") {
        fieldErrors.service = "対象のサービスを選んでください";
      } else if (!PRODUCT_SERVICES.has(rawService as ContactService)) {
        return {
          ok: false,
          status: 400,
          code: "invalid_request",
          message: "ご相談の種別と対象サービスの組み合わせが不正です。",
        };
      } else {
        resolvedService = rawService as ContactService;
      }
    } else if (category === "security") {
      if (rawService === "") {
        fieldErrors.service = "対象のサービスを選んでください";
      } else if (!SECURITY_SERVICES.has(rawService as ContactService)) {
        return {
          ok: false,
          status: 400,
          code: "invalid_request",
          message: "ご相談の種別と対象サービスの組み合わせが不正です。",
        };
      } else {
        resolvedService = rawService as ContactService;
      }
    } else {
      // business, partnership, other
      const allowedContextServices = new Set<string>(["", "general"]);
      if (rawContext === "oshieai") allowedContextServices.add("oshieai");
      if (rawContext === "datacenter") allowedContextServices.add("datacenter");
      if (!allowedContextServices.has(rawService)) {
        return {
          ok: false,
          status: 400,
          code: "invalid_request",
          message: "ご相談の種別と対象サービスの組み合わせが不正です。",
        };
      }
      resolvedService =
        rawService === "oshieai" || rawService === "datacenter"
          ? (rawService as ContactService)
          : "general";
    }
  }

  if (rawOrganization !== "" && codePointLength(rawOrganization) > 100) {
    fieldErrors.organization = "会社名・組織名は100文字以内で入力してください";
  }

  const nameLen = codePointLength(rawName);
  if (nameLen === 0) {
    fieldErrors.name = "お名前を入力してください";
  } else if (nameLen > 100) {
    fieldErrors.name = "お名前は100文字以内で入力してください";
  }

  if (rawEmail === "") {
    fieldErrors.email = "メールアドレスを入力してください";
  } else if (!isValidEmail(rawEmail)) {
    fieldErrors.email = "メールアドレスをご確認ください。例：name@example.com";
  }

  const messageLen = codePointLength(rawMessage);
  if (messageLen === 0) {
    fieldErrors.message = "ご相談内容を入力してください";
  } else if (messageLen > 5000) {
    fieldErrors.message = "ご相談内容は5,000文字以内で入力してください";
  }

  const allowsReference = category === "open_estimate" || category === "security";
  if (!allowsReference && rawReference !== "") {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "現在の種別では補足参照欄は指定できません。",
    };
  }
  if (rawReference !== "" && codePointLength(rawReference) > 500) {
    fieldErrors.reference = "対象ページURL・証明書IDなどは500文字以内で入力してください";
  }

  if (rawPhone !== "" && !isValidPhone(rawPhone)) {
    fieldErrors.phone = "電話番号は30文字以内で正しく入力してください";
  }

  if (obj.privacyAccepted !== true) {
    fieldErrors.privacyAccepted =
      "プライバシーポリシーをご確認のうえ、同意にチェックしてください";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      status: 422,
      code: "validation_error",
      message: "入力内容に確認が必要な項目があります。",
      fieldErrors,
    };
  }

  return {
    ok: true,
    data: {
      schemaVersion: 1,
      category,
      service: resolvedService,
      organization: rawOrganization === "" ? null : rawOrganization,
      name: rawName,
      email: rawEmail,
      message: rawMessage,
      reference: allowsReference && rawReference !== "" ? rawReference : null,
      phone: rawPhone === "" ? null : rawPhone,
      privacyAccepted: true,
      privacyVersion: rawPrivacyVersion,
      context: rawContext as ContactContext,
      turnstileToken: rawTurnstileToken,
    },
  };
}

/**
 * Computes SHA-256 hex digest of normalized input fields.
 * Excludes turnstileToken and website per Section 9.2 step 2.
 */
export async function computePayloadHash(input: NormalizedContactInput): Promise<string> {
  const canonical = JSON.stringify({
    schemaVersion: input.schemaVersion,
    category: input.category,
    service: input.service,
    organization: input.organization ?? "",
    name: input.name,
    email: input.email,
    message: input.message,
    reference: input.reference ?? "",
    phone: input.phone ?? "",
    privacyAccepted: input.privacyAccepted,
    privacyVersion: input.privacyVersion,
    context: input.context,
  });
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

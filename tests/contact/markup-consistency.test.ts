/**
 * Automated tests verifying markup parity across the 3 contact pages,
 * removal of legacy Tally/modal references (OPS-01), and thanks.html structure (OPS-02).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const PAGES = [
  { path: "public/index.html", context: "home" },
  { path: "public/products/oshieai/index.html", context: "oshieai" },
  { path: "public/ai-infra/datacenter/index.html", context: "datacenter" },
] as const;

const REQUIRED_FORM_IDS = [
  "aioContactForm",
  "contactCategoryFieldset",
  "contactCategory-business",
  "contactCategory-partnership",
  "contactCategory-product",
  "contactCategory-open_estimate",
  "contactCategory-security",
  "contactCategory-other",
  "contactServiceField",
  "contactService",
  "contactFixedServiceField",
  "contactOrganization",
  "contactName",
  "contactEmail",
  "contactMessage",
  "contactCategoryGuideText",
  "contactCharCounter",
  "contactReferenceField",
  "contactReference",
  "contactPhoneDetails",
  "contactPhone",
  "contactPrivacy",
  "contactTurnstileSlot",
  "contactSubmitBtn",
  "contactErrorSummary",
  "contactStatusBanner",
  "contactPreparingNote",
];

describe("HTML Form Markup Consistency & OPS Checks (OPS-01, OPS-02)", () => {
  it("verifies all 3 contact pages share the exact same form field IDs, constraints, CSS/JS references, and context attributes", () => {
    for (const page of PAGES) {
      const html = readFileSync(resolve(process.cwd(), page.path), "utf8");

      assert.ok(
        html.includes(`data-contact-context="${page.context}"`),
        `${page.path} must declare data-contact-context="${page.context}"`
      );
      assert.ok(
        html.includes('href="/contact.css"'),
        `${page.path} must include /contact.css`
      );
      assert.ok(
        html.includes('src="/contact.js"'),
        `${page.path} must include /contact.js`
      );

      for (const id of REQUIRED_FORM_IDS) {
        assert.ok(
          html.includes(`id="${id}"`),
          `${page.path} is missing required form element id="${id}"`
        );
      }

      // Verify identical core copy and constraints
      assert.ok(
        html.includes("パスワードやAPIキー、機密資料などは入力しないでください。"),
        `${page.path} missing caution copy`
      );
      assert.ok(
        html.includes(
          "お問い合わせへの対応を目的として情報を取り扱います。内容の整理や返信案の作成に、OpenAIのChatGPTを利用する場合があります。"
        ),
        `${page.path} missing AI disclosure copy`
      );
      assert.ok(
        html.includes("この内容で送信する"),
        `${page.path} missing submit button copy`
      );
    }
  });

  it("OPS-01: verifies zero legacy Tally iframe, Tally widget script, or obPAq1 links remain in public files", () => {
    const filesToCheck = [
      "public/index.html",
      "public/products/oshieai/index.html",
      "public/ai-infra/datacenter/index.html",
      "public/security/index.html",
      "public/privacy/index.html",
      "public/script.js",
      "public/styles.css",
    ];

    for (const relPath of filesToCheck) {
      const content = readFileSync(resolve(process.cwd(), relPath), "utf8");
      assert.ok(
        !content.includes("tally.so"),
        `${relPath} still contains tally.so reference`
      );
      assert.ok(
        !content.includes("obPAq1"),
        `${relPath} still contains obPAq1 reference`
      );
      assert.ok(
        !content.includes("contactTallyFrame"),
        `${relPath} still contains contactTallyFrame reference`
      );
      assert.ok(
        !content.includes("privacyModal"),
        `${relPath} still contains legacy privacyModal reference`
      );
    }

    // Verify security page has the new query-based links
    const securityHtml = readFileSync(
      resolve(process.cwd(), "public/security/index.html"),
      "utf8"
    );
    assert.ok(securityHtml.includes("/?inquiry=security#contact"));
    assert.ok(securityHtml.includes("/?inquiry=open-estimate#contact"));
  });

  it("OPS-02: verifies thanks.html defaults to neutral view and loads /receipt.js with noindex", () => {
    const thanksHtml = readFileSync(
      resolve(process.cwd(), "public/thanks.html"),
      "utf8"
    );
    assert.ok(thanksHtml.includes('name="robots" content="noindex, follow"'));
    assert.ok(thanksHtml.includes('src="/receipt.js"'));
    assert.ok(
      /<section[^>]*id="receiptAcceptedView"[^>]*hidden/.test(thanksHtml),
      "receiptAcceptedView must be hidden by default in HTML so direct visitors do not see a false accepted state"
    );
    assert.ok(
      /<section[^>]*id="receiptNeutralView"(?![^>]*hidden)/.test(thanksHtml),
      "receiptNeutralView must be visible by default for direct visitors"
    );
  });
});

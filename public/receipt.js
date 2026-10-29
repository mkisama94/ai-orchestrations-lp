/**
 * AI Orchestration - Receipt Page Controller (public/receipt.js)
 * Reads minimal receipt metadata from sessionStorage (valid for 24 hours).
 * Renders neutral guidance if visited directly without a recent submission.
 */
(function () {
  "use strict";

  const RECEIPT_STORAGE_KEY = "aio_contact_receipt";
  const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  function readValidReceipt() {
    try {
      const raw = window.sessionStorage.getItem(RECEIPT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const receiptId =
        typeof parsed.receiptId === "string" ? parsed.receiptId.trim() : "";
      const receivedAt =
        typeof parsed.receivedAt === "string" ? parsed.receivedAt.trim() : "";

      if (!/^AIO-[A-Z0-9-]{4,32}$/.test(receiptId)) {
        return null;
      }

      const ts = Date.parse(receivedAt);
      if (Number.isNaN(ts)) {
        return null;
      }

      const ageMs = Date.now() - ts;
      if (ageMs > MAX_AGE_MS || ageMs < -5 * 60 * 1000) {
        window.sessionStorage.removeItem(RECEIPT_STORAGE_KEY);
        return null;
      }

      return { receiptId, receivedAt };
    } catch {
      return null;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const acceptedSection = document.getElementById("receiptAcceptedView");
    const neutralSection = document.getElementById("receiptNeutralView");
    const receiptIdEl = document.getElementById("receiptIdValue");
    const copyBtn = document.getElementById("receiptCopyBtn");
    const copyStatusEl = document.getElementById("receiptCopyStatus");

    const receipt = readValidReceipt();

    if (receipt && acceptedSection && receiptIdEl) {
      document.title = "お問い合わせを受け付けました｜AI Orchestration";
      receiptIdEl.textContent = receipt.receiptId;
      if (neutralSection) neutralSection.hidden = true;
      acceptedSection.hidden = false;

      if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(receipt.receiptId);
            copyBtn.textContent = "コピーしました";
            if (copyStatusEl) {
              copyStatusEl.textContent = "受付番号をクリップボードにコピーしました。";
            }
            setTimeout(() => {
              copyBtn.textContent = "受付番号をコピー";
            }, 2500);
          } catch {
            if (copyStatusEl) {
              copyStatusEl.textContent =
                "自動コピーできませんでした。表示されている受付番号を選択してコピーしてください。";
            }
          }
        });
      }
    } else {
      document.title = "お問い合わせ窓口のご案内｜AI Orchestration";
      if (acceptedSection) acceptedSection.hidden = true;
      if (neutralSection) neutralSection.hidden = false;
    }
  });
})();

/**
 * AI Orchestration - Contact Form Controller (public/contact.js)
 * Implements category switching, validation, Turnstile, idempotent submission,
 * retry handling, analytics events (no PII), and accessible receipt routing.
 */
(function () {
  "use strict";

  const PRIVACY_VERSION = "contact-2026-10-29";
  const RECEIPT_STORAGE_KEY = "aio_contact_receipt";
  const REQUEST_TIMEOUT_MS = 15000;

  const ALLOWED_CATEGORIES = new Set([
    "business",
    "partnership",
    "product",
    "open_estimate",
    "security",
    "other",
  ]);

  const ALLOWED_CONTEXTS = new Set(["home", "oshieai", "datacenter"]);

  const CATEGORY_LABELS = {
    business: "事業・開発のご相談",
    partnership: "協業・パートナーシップ",
    product: "製品・サービスについて",
    open_estimate: "Open Estimateについて",
    security: "セキュリティに関する報告",
    other: "その他",
  };

  const SERVICE_LABELS = {
    general: "AI Orchestration Webサイト・共通基盤",
    oshieai: "教AI（おしえあい）",
    datacenter: "低環境負荷＆分散型AIデータセンター",
    open_estimate: "Open Estimate",
    other: "その他",
    unknown: "不明・まだ決まっていない",
  };

  const CATEGORY_GUIDES = {
    business:
      "実現したいこと、現在の状況、相談したいことをお書きください。支援メニューが未定でも構いません。",
    partnership:
      "ご提案の概要と、想定している役割や連携内容をお書きください。",
    product: "対象サービスと、ご質問・ご相談の内容をお書きください。",
    open_estimate:
      "計算証明書・公開内容など、ご相談の内容をお書きください。証明書IDや公開URLが分かる場合は下の補足欄へご記入ください。",
    security:
      "対象サービスと事象の概要をお知らせください。パスワード、APIキー、個人情報を含むログは送信しないでください。詳細の共有方法は折り返しご案内します。",
    other: "お問い合わせの内容をお書きください。",
    default: "実現したいことや、現在の状況をお書きください。",
  };

  const PRODUCT_SERVICE_OPTIONS = [
    { value: "", label: "選択してください" },
    { value: "oshieai", label: "教AI（おしえあい）" },
    { value: "datacenter", label: "低環境負荷＆分散型AIデータセンター" },
    { value: "other", label: "その他" },
    { value: "unknown", label: "不明・まだ決まっていない" },
  ];

  const SECURITY_SERVICE_OPTIONS = [
    { value: "", label: "選択してください" },
    { value: "oshieai", label: "教AI（おしえあい）" },
    { value: "datacenter", label: "低環境負荷＆分散型AIデータセンター" },
    { value: "open_estimate", label: "Open Estimate" },
    { value: "general", label: "AI Orchestration Webサイト・共通基盤" },
    { value: "other", label: "その他" },
    { value: "unknown", label: "不明" },
  ];

  function codePointLength(str) {
    return Array.from(str || "").length;
  }

  function normalizeEmail(raw) {
    const trimmed = (raw || "").trim();
    const atIndex = trimmed.lastIndexOf("@");
    if (atIndex <= 0 || atIndex === trimmed.length - 1) {
      return trimmed;
    }
    const local = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex + 1).toLowerCase();
    return local + "@" + domain;
  }

  function isValidEmail(email) {
    if (!email || codePointLength(email) > 254 || email.length > 254) {
      return false;
    }
    if (/[\r\n\0\s]/.test(email)) {
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
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
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

  function isValidPhone(phone) {
    if (codePointLength(phone) > 30) return false;
    if (/[\r\n\0]/.test(phone)) return false;
    if (!/^[0-9+\-() .　ー－]+$/.test(phone)) return false;
    const digits = (phone.match(/[0-9]/g) || []).length;
    return digits >= 6 && digits <= 20;
  }

  function generateUuidV4() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }

  function trackAnalyticsEvent(eventName, params) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName, params || {});
      }
    } catch {
      // Ignore analytics errors
    }
  }

  function parseAllowedQueryInquiry() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = (params.get("inquiry") || "").trim().toLowerCase();
      if (raw === "security") {
        return { category: "security", service: "" };
      }
      if (raw === "open-estimate" || raw === "open_estimate") {
        return { category: "open_estimate", service: "open_estimate" };
      }
      if (raw === "product") {
        return { category: "product", service: "" };
      }
      if (raw === "business") {
        return { category: "business", service: "general" };
      }
      if (raw === "partnership") {
        return { category: "partnership", service: "general" };
      }
      if (raw === "other") {
        return { category: "other", service: "general" };
      }
    } catch {
      // Ignore URL parsing errors
    }
    return null;
  }

  function initContactSection(sectionEl) {
    const form = sectionEl.querySelector("#aioContactForm");
    if (!form) return;

    const rawContext = (sectionEl.getAttribute("data-contact-context") || "home").trim();
    const pageContext = ALLOWED_CONTEXTS.has(rawContext) ? rawContext : "home";
    const defaultCategory = (sectionEl.getAttribute("data-default-category") || "").trim();
    const defaultService = (sectionEl.getAttribute("data-default-service") || "").trim();
    const turnstileSiteKey = (
      sectionEl.getAttribute("data-turnstile-sitekey") || "1x00000000000000000000AA"
    ).trim();

    // Elements
    const presetBanner = sectionEl.querySelector("#contactPresetBanner");
    const presetBannerText = sectionEl.querySelector("#contactPresetBannerText");
    const errorSummary = sectionEl.querySelector("#contactErrorSummary");
    const errorSummaryTitle = sectionEl.querySelector("#contactErrorSummaryTitle");
    const errorSummaryList = sectionEl.querySelector("#contactErrorSummaryList");
    const statusBanner = sectionEl.querySelector("#contactStatusBanner");
    const preparingNote = sectionEl.querySelector("#contactPreparingNote");
    const jsFallbackBox = sectionEl.querySelector("#contactJsFallback");

    const categoryFieldset = sectionEl.querySelector("#contactCategoryFieldset");
    const categoryRadios = Array.from(
      sectionEl.querySelectorAll('input[name="category"]')
    );
    const categoryOptions = Array.from(
      sectionEl.querySelectorAll(".aio-category-option")
    );

    const serviceField = sectionEl.querySelector("#contactServiceField");
    const serviceSelect = sectionEl.querySelector("#contactService");
    const serviceProductHint = sectionEl.querySelector("#contactServiceProductHint");
    const fixedServiceField = sectionEl.querySelector("#contactFixedServiceField");

    const organizationInput = sectionEl.querySelector("#contactOrganization");
    const nameInput = sectionEl.querySelector("#contactName");
    const emailInput = sectionEl.querySelector("#contactEmail");
    const messageInput = sectionEl.querySelector("#contactMessage");
    const categoryGuideText = sectionEl.querySelector("#contactCategoryGuideText");
    const securitySpecLinkWrap = sectionEl.querySelector("#contactSecuritySpecLinkWrap");
    const charCounter = sectionEl.querySelector("#contactCharCounter");

    const referenceField = sectionEl.querySelector("#contactReferenceField");
    const referenceInput = sectionEl.querySelector("#contactReference");

    const phoneDetails = sectionEl.querySelector("#contactPhoneDetails");
    const phoneInput = sectionEl.querySelector("#contactPhone");

    const privacyRow = sectionEl.querySelector("#contactPrivacyRow");
    const privacyCheckbox = sectionEl.querySelector("#contactPrivacy");
    const websiteHoneypot = sectionEl.querySelector("#contactWebsite");

    const turnstileSlot = sectionEl.querySelector("#contactTurnstileSlot");
    const submitBtn = sectionEl.querySelector("#contactSubmitBtn");
    const submitBtnLabel = sectionEl.querySelector("#contactSubmitBtnLabel");
    const liveStatus = sectionEl.querySelector("#contactLiveStatus");

    // In-memory state
    let hasStartedTracked = false;
    let hasSubmittedTracked = false;
    let hasAttemptedSubmit = false;
    const touchedErrors = new Set();
    let isComposing = false;
    let isSubmitting = false;

    // Preserve service selection per category in memory
    let rememberedProductService =
      defaultService === "oshieai" || defaultService === "datacenter"
        ? defaultService
        : "";
    let rememberedSecurityService =
      defaultService === "oshieai" || defaultService === "datacenter"
        ? defaultService
        : "";

    // Idempotency state
    let activeIdempotencyKey = null;
    let activePayloadSignature = null;

    // Turnstile state
    let turnstileToken = "";
    let turnstileWidgetId = null;
    let turnstileCurrentSize = null;
    let turnstileUnavailable = false;

    function announceStatus(text) {
      if (liveStatus) {
        liveStatus.textContent = text || "";
      }
    }

    function showStatusBanner(message, type) {
      if (!statusBanner) return;
      if (!message) {
        statusBanner.hidden = true;
        statusBanner.textContent = "";
        statusBanner.className = "aio-status-banner";
        return;
      }
      statusBanner.hidden = false;
      statusBanner.className =
        "aio-status-banner" +
        (type === "error"
          ? " is-error"
          : type === "warning"
            ? " is-warning"
            : "");
      statusBanner.textContent = message;
    }

    function getSelectedCategory() {
      const checked = categoryRadios.find((r) => r.checked);
      return checked ? checked.value : "";
    }

    function populateServiceOptions(category, preferredValue) {
      if (!serviceSelect) return;
      const options =
        category === "security" ? SECURITY_SERVICE_OPTIONS : PRODUCT_SERVICE_OPTIONS;
      serviceSelect.innerHTML = "";
      options.forEach((opt) => {
        const el = document.createElement("option");
        el.value = opt.value;
        el.textContent = opt.label;
        serviceSelect.appendChild(el);
      });
      const validValues = new Set(options.map((o) => o.value));
      if (preferredValue && validValues.has(preferredValue)) {
        serviceSelect.value = preferredValue;
      } else {
        serviceSelect.value = "";
      }
    }

    function updatePresetBanner(category) {
      if (!presetBanner || !presetBannerText) return;
      if (!category) {
        presetBanner.hidden = true;
        return;
      }
      const catLabel = CATEGORY_LABELS[category] || category;
      let detail = catLabel;
      if (category === "product" || category === "security") {
        const svc = serviceSelect ? serviceSelect.value : "";
        if (svc && SERVICE_LABELS[svc]) {
          detail = catLabel + " ／ " + SERVICE_LABELS[svc];
        }
      } else if (category === "open_estimate") {
        detail = catLabel + " ／ Open Estimate";
      }
      if (pageContext !== "home" || parseAllowedQueryInquiry() !== null) {
        presetBannerText.textContent = "選択中の窓口：" + detail;
        presetBanner.hidden = false;
      } else {
        presetBanner.hidden = true;
      }
    }

    function syncCategoryVisuals() {
      const category = getSelectedCategory();

      categoryOptions.forEach((opt) => {
        const input = opt.querySelector('input[name="category"]');
        const isChecked = Boolean(input && input.checked);
        opt.classList.toggle("is-selected", isChecked);
      });

      // Update dynamic helper guide above message
      if (categoryGuideText) {
        categoryGuideText.textContent =
          CATEGORY_GUIDES[category] || CATEGORY_GUIDES.default;
      }

      if (securitySpecLinkWrap) {
        securitySpecLinkWrap.hidden = category !== "security";
      }

      // Update conditional service field
      if (category === "product") {
        if (serviceField) serviceField.hidden = false;
        if (serviceProductHint) serviceProductHint.hidden = false;
        if (fixedServiceField) fixedServiceField.hidden = true;
        populateServiceOptions("product", rememberedProductService);
      } else if (category === "security") {
        if (serviceField) serviceField.hidden = false;
        if (serviceProductHint) serviceProductHint.hidden = true;
        if (fixedServiceField) fixedServiceField.hidden = true;
        populateServiceOptions("security", rememberedSecurityService);
      } else if (category === "open_estimate") {
        if (serviceField) serviceField.hidden = true;
        if (fixedServiceField) fixedServiceField.hidden = false;
      } else {
        if (serviceField) serviceField.hidden = true;
        if (fixedServiceField) fixedServiceField.hidden = true;
      }

      // Update conditional reference field
      const showReference =
        category === "open_estimate" || category === "security";
      if (referenceField) {
        referenceField.hidden = !showReference;
      }

      updatePresetBanner(category);
    }

    function applyInitialSelection() {
      const queryOverride = parseAllowedQueryInquiry();
      let initialCat = "";
      let initialSvc = "";

      if (queryOverride) {
        initialCat = queryOverride.category;
        initialSvc = queryOverride.service;
      } else if (defaultCategory && ALLOWED_CATEGORIES.has(defaultCategory)) {
        initialCat = defaultCategory;
        initialSvc = defaultService;
      }

      if (initialSvc) {
        if (initialCat === "product") rememberedProductService = initialSvc;
        if (initialCat === "security") rememberedSecurityService = initialSvc;
      }

      if (initialCat) {
        categoryRadios.forEach((radio) => {
          radio.checked = radio.value === initialCat;
        });
      } else {
        categoryRadios.forEach((radio) => {
          radio.checked = false;
        });
      }

      syncCategoryVisuals();
    }

    function updateCharCounter() {
      if (!messageInput || !charCounter) return;
      const normalized = messageInput.value.replace(/\r\n?/g, "\n");
      const len = codePointLength(normalized);
      const remaining = 5000 - len;
      if (remaining >= 0) {
        charCounter.textContent =
          len.toLocaleString("ja-JP") +
          " / 5,000文字（残り " +
          remaining.toLocaleString("ja-JP") +
          "文字）";
        charCounter.classList.remove("is-over");
      } else {
        charCounter.textContent =
          len.toLocaleString("ja-JP") +
          " / 5,000文字（" +
          Math.abs(remaining).toLocaleString("ja-JP") +
          "文字超過）";
        charCounter.classList.add("is-over");
      }
    }

    // Field error display helpers
    const FIELD_CONFIG = {
      category: {
        errorEl: sectionEl.querySelector("#contactCategoryError"),
        targetEl: categoryFieldset,
        focusEl: categoryRadios[0],
        anchorId: "contactCategory-business",
      },
      service: {
        errorEl: sectionEl.querySelector("#contactServiceError"),
        targetEl: serviceSelect,
        focusEl: serviceSelect,
        anchorId: "contactService",
      },
      organization: {
        errorEl: sectionEl.querySelector("#contactOrganizationError"),
        targetEl: organizationInput,
        focusEl: organizationInput,
        anchorId: "contactOrganization",
      },
      name: {
        errorEl: sectionEl.querySelector("#contactNameError"),
        targetEl: nameInput,
        focusEl: nameInput,
        anchorId: "contactName",
      },
      email: {
        errorEl: sectionEl.querySelector("#contactEmailError"),
        targetEl: emailInput,
        focusEl: emailInput,
        anchorId: "contactEmail",
      },
      message: {
        errorEl: sectionEl.querySelector("#contactMessageError"),
        targetEl: messageInput,
        focusEl: messageInput,
        anchorId: "contactMessage",
      },
      reference: {
        errorEl: sectionEl.querySelector("#contactReferenceError"),
        targetEl: referenceInput,
        focusEl: referenceInput,
        anchorId: "contactReference",
      },
      phone: {
        errorEl: sectionEl.querySelector("#contactPhoneError"),
        targetEl: phoneInput,
        focusEl: phoneInput,
        anchorId: "contactPhone",
      },
      privacyAccepted: {
        errorEl: sectionEl.querySelector("#contactPrivacyError"),
        targetEl: privacyCheckbox,
        focusEl: privacyCheckbox,
        anchorId: "contactPrivacy",
      },
    };

    function setFieldError(fieldName, errorMessage) {
      const cfg = FIELD_CONFIG[fieldName];
      if (!cfg || !cfg.errorEl || !cfg.targetEl) return;

      const textSpan = cfg.errorEl.querySelector(".aio-field-error-text");
      if (errorMessage) {
        if (textSpan) {
          textSpan.textContent = errorMessage;
        } else {
          cfg.errorEl.textContent = errorMessage;
        }
        cfg.errorEl.hidden = false;
        cfg.targetEl.setAttribute("aria-invalid", "true");

        const baseDescribedBy =
          cfg.targetEl.getAttribute("data-base-describedby") || "";
        const errorId = cfg.errorEl.id;
        const tokens = baseDescribedBy
          .split(/\s+/)
          .filter(Boolean);
        if (errorId && !tokens.includes(errorId)) {
          tokens.push(errorId);
        }
        if (tokens.length > 0) {
          cfg.targetEl.setAttribute("aria-describedby", tokens.join(" "));
        }

        if (fieldName === "privacyAccepted" && privacyRow) {
          privacyRow.classList.add("is-invalid");
        }
        if (fieldName === "phone" && phoneDetails && !phoneDetails.open) {
          phoneDetails.open = true;
        }
      } else {
        cfg.errorEl.hidden = true;
        if (textSpan) textSpan.textContent = "";
        cfg.targetEl.removeAttribute("aria-invalid");

        const baseDescribedBy =
          cfg.targetEl.getAttribute("data-base-describedby") || "";
        if (baseDescribedBy) {
          cfg.targetEl.setAttribute("aria-describedby", baseDescribedBy);
        } else {
          cfg.targetEl.removeAttribute("aria-describedby");
        }

        if (fieldName === "privacyAccepted" && privacyRow) {
          privacyRow.classList.remove("is-invalid");
        }
      }
    }

    function computeValidationErrors() {
      const errors = {};
      const category = getSelectedCategory();

      if (!category) {
        errors.category = "ご相談の種別を選んでください";
      } else if (category === "product" || category === "security") {
        const svc = serviceSelect ? serviceSelect.value.trim() : "";
        if (!svc) {
          errors.service = "対象のサービスを選んでください";
        }
      }

      const orgVal = organizationInput ? organizationInput.value.trim() : "";
      if (orgVal && codePointLength(orgVal) > 100) {
        errors.organization = "会社名・組織名は100文字以内で入力してください";
      }

      const nameVal = nameInput ? nameInput.value.trim() : "";
      const nameLen = codePointLength(nameVal);
      if (nameLen === 0) {
        errors.name = "お名前を入力してください";
      } else if (nameLen > 100) {
        errors.name = "お名前は100文字以内で入力してください";
      }

      const emailVal = emailInput ? normalizeEmail(emailInput.value) : "";
      if (!emailVal) {
        errors.email = "メールアドレスを入力してください";
      } else if (!isValidEmail(emailVal)) {
        errors.email = "メールアドレスをご確認ください。例：name@example.com";
      }

      const msgVal = messageInput
        ? messageInput.value.replace(/\r\n?/g, "\n").trim()
        : "";
      const msgLen = codePointLength(msgVal);
      if (msgLen === 0) {
        errors.message = "ご相談内容を入力してください";
      } else if (msgLen > 5000) {
        errors.message = "ご相談内容は5,000文字以内で入力してください";
      }

      if (category === "open_estimate" || category === "security") {
        const refVal = referenceInput ? referenceInput.value.trim() : "";
        if (refVal && codePointLength(refVal) > 500) {
          errors.reference =
            "対象ページURL・証明書IDなどは500文字以内で入力してください";
        }
      }

      const phoneVal = phoneInput ? phoneInput.value.trim() : "";
      if (phoneVal && !isValidPhone(phoneVal)) {
        errors.phone = "電話番号は30文字以内で正しく入力してください";
      }

      if (!privacyCheckbox || !privacyCheckbox.checked) {
        errors.privacyAccepted =
          "プライバシーポリシーをご確認のうえ、同意にチェックしてください";
      }

      return errors;
    }

    function renderErrorSummary(errors, shouldFocusSummary) {
      if (!errorSummary || !errorSummaryList || !errorSummaryTitle) return;
      const entries = Object.entries(errors);
      if (entries.length === 0) {
        errorSummary.hidden = true;
        errorSummaryList.innerHTML = "";
        return;
      }

      errorSummaryTitle.textContent =
        "入力内容をご確認ください（" + entries.length + "件）";
      errorSummaryList.innerHTML = "";

      entries.forEach(([field, msg]) => {
        const cfg = FIELD_CONFIG[field];
        const li = document.createElement("li");
        if (cfg && cfg.anchorId) {
          const a = document.createElement("a");
          a.href = "#" + cfg.anchorId;
          a.textContent = msg;
          a.addEventListener("click", (e) => {
            e.preventDefault();
            if (field === "phone" && phoneDetails) {
              phoneDetails.open = true;
            }
            if (cfg.focusEl && typeof cfg.focusEl.focus === "function") {
              cfg.focusEl.focus();
            }
          });
          li.appendChild(a);
        } else {
          li.textContent = msg;
        }
        errorSummaryList.appendChild(li);
      });

      errorSummary.hidden = false;
      if (shouldFocusSummary) {
        errorSummary.focus();
      }
    }

    function validateSingleFieldIfTouched(fieldName) {
      if (!hasAttemptedSubmit && !touchedErrors.has(fieldName)) return;
      const allErrors = computeValidationErrors();
      const msg = allErrors[fieldName] || "";
      setFieldError(fieldName, msg);
      if (!msg) {
        touchedErrors.delete(fieldName);
      }
      if (hasAttemptedSubmit) {
        renderErrorSummary(allErrors, false);
      }
    }

    function resolveServiceForPayload(category) {
      if (category === "open_estimate") {
        return "open_estimate";
      }
      if (category === "product" || category === "security") {
        return serviceSelect ? serviceSelect.value.trim() : "";
      }
      if (pageContext === "oshieai") return "oshieai";
      if (pageContext === "datacenter") return "datacenter";
      return "general";
    }

    function buildPayload(currentTurnstileToken) {
      const category = getSelectedCategory();
      const service = resolveServiceForPayload(category);
      const allowsReference =
        category === "open_estimate" || category === "security";

      return {
        schemaVersion: 1,
        category,
        service,
        organization: organizationInput ? organizationInput.value.trim() : "",
        name: nameInput ? nameInput.value.trim() : "",
        email: emailInput ? normalizeEmail(emailInput.value) : "",
        message: messageInput
          ? messageInput.value.replace(/\r\n?/g, "\n").trim()
          : "",
        reference:
          allowsReference && referenceInput ? referenceInput.value.trim() : "",
        phone: phoneInput ? phoneInput.value.trim() : "",
        privacyAccepted: Boolean(privacyCheckbox && privacyCheckbox.checked),
        privacyVersion: PRIVACY_VERSION,
        context: pageContext,
        turnstileToken: currentTurnstileToken || "",
        website: websiteHoneypot ? websiteHoneypot.value : "",
      };
    }

    function computeSignatureWithoutToken(payload) {
      return JSON.stringify({
        schemaVersion: payload.schemaVersion,
        category: payload.category,
        service: payload.service,
        organization: payload.organization,
        name: payload.name,
        email: payload.email,
        message: payload.message,
        reference: payload.reference,
        phone: payload.phone,
        privacyAccepted: payload.privacyAccepted,
        privacyVersion: payload.privacyVersion,
        context: payload.context,
      });
    }

    function getOrRotateIdempotencyKey(payload) {
      const signature = computeSignatureWithoutToken(payload);
      if (!activeIdempotencyKey || activePayloadSignature !== signature) {
        activeIdempotencyKey = generateUuidV4();
        activePayloadSignature = signature;
      }
      return activeIdempotencyKey;
    }

    function setFormEditingLocked(locked) {
      isSubmitting = locked;
      const controls = form.querySelectorAll("input, select, textarea, button");
      controls.forEach((el) => {
        if (el === submitBtn) return;
        el.disabled = locked;
      });
      if (submitBtn) {
        submitBtn.disabled = locked;
        submitBtn.setAttribute("aria-busy", locked ? "true" : "false");
      }
      if (submitBtnLabel) {
        submitBtnLabel.textContent = locked
          ? "送信しています…"
          : "この内容で送信する";
      }
    }

    // Turnstile responsive widget management (Section 6.2)
    function computeDesiredTurnstileSize() {
      if (!turnstileSlot) return "flexible";
      const width =
        turnstileSlot.clientWidth ||
        form.clientWidth ||
        window.innerWidth - 64;
      return width < 300 ? "compact" : "flexible";
    }

    function renderOrUpdateTurnstile(forceRecreate) {
      if (!turnstileSlot) return;
      if (
        typeof window.turnstile === "undefined" ||
        typeof window.turnstile.render !== "function"
      ) {
        return;
      }

      const desiredSize = computeDesiredTurnstileSize();
      if (
        !forceRecreate &&
        turnstileWidgetId !== null &&
        turnstileCurrentSize === desiredSize
      ) {
        return;
      }

      if (turnstileWidgetId !== null) {
        // Size changed: discard existing token and re-verify per Section 6.2
        turnstileToken = "";
        try {
          window.turnstile.remove(turnstileWidgetId);
        } catch {
          // ignore
        }
        turnstileWidgetId = null;
      }

      turnstileCurrentSize = desiredSize;
      turnstileSlot.innerHTML = "";

      try {
        turnstileWidgetId = window.turnstile.render(turnstileSlot, {
          sitekey: turnstileSiteKey,
          action: "contact",
          appearance: "interaction-only",
          size: desiredSize,
          theme: "light",
          callback: function (token) {
            turnstileToken = token || "";
            turnstileUnavailable = false;
            showStatusBanner("", "");
          },
          "expired-callback": function () {
            turnstileToken = "";
            showStatusBanner(
              "確認の有効期限が切れました。もう一度確認してください。",
              "warning"
            );
            try {
              if (turnstileWidgetId !== null) {
                window.turnstile.reset(turnstileWidgetId);
              }
            } catch {
              // ignore
            }
          },
          "error-callback": function () {
            turnstileToken = "";
            turnstileUnavailable = true;
            showStatusBanner(
              "不正送信防止の確認を読み込めませんでした。広告ブロッカー等を解除して再読み込みするか、代替窓口（support@ai-orchestration.jp）へメールでご連絡ください。",
              "error"
            );
          },
        });
      } catch {
        turnstileUnavailable = true;
      }
    }

    // Watch for Turnstile script load or resize across 300px threshold
    function setupTurnstileLifecycle() {
      if (window.turnstile && typeof window.turnstile.render === "function") {
        renderOrUpdateTurnstile(true);
      } else {
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          if (window.turnstile && typeof window.turnstile.render === "function") {
            clearInterval(poll);
            renderOrUpdateTurnstile(true);
          } else if (attempts >= 25) {
            clearInterval(poll);
            // If Turnstile script was blocked, allow test hook or show clear guidance on submit
            if (!window.__AIO_TURNSTILE_TEST_TOKEN__) {
              turnstileUnavailable = true;
            }
          }
        }, 200);
      }

      window.addEventListener("resize", () => {
        if (turnstileWidgetId !== null) {
          const nextSize = computeDesiredTurnstileSize();
          if (nextSize !== turnstileCurrentSize) {
            renderOrUpdateTurnstile(true);
          }
        }
      });
    }

    // Inline completion fallback when sessionStorage is blocked (Section 6.3)
    function renderInlineReceiptFallback(receiptId) {
      const panel = sectionEl.querySelector(".aio-contact-panel");
      if (!panel) return;

      panel.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "aio-inline-receipt";
      wrap.setAttribute("role", "status");
      wrap.setAttribute("aria-live", "polite");

      const badge = document.createElement("div");
      badge.className = "aio-inline-receipt-badge";
      badge.textContent = "RECEIVED / 受付完了";

      const title = document.createElement("h3");
      title.className = "aio-inline-receipt-title";
      title.textContent = "お問い合わせを受け付けました。";

      const box = document.createElement("div");
      box.className = "aio-inline-receipt-box";

      const idLabel = document.createElement("div");
      idLabel.className = "aio-inline-receipt-id-label";
      idLabel.textContent = "受付番号";

      const idRow = document.createElement("div");
      idRow.className = "aio-inline-receipt-id-row";

      const idValue = document.createElement("span");
      idValue.className = "aio-inline-receipt-id";
      idValue.textContent = receiptId;

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "aio-copy-receipt-btn";
      copyBtn.textContent = "受付番号をコピー";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(receiptId);
          copyBtn.textContent = "コピーしました";
        } catch {
          copyBtn.textContent = "選択してコピーしてください";
        }
      });

      idRow.appendChild(idValue);
      idRow.appendChild(copyBtn);
      box.appendChild(idLabel);
      box.appendChild(idRow);

      const desc = document.createElement("p");
      desc.style.fontSize = "16px";
      desc.style.lineHeight = "1.8";
      desc.style.margin = "16px 0 24px 0";
      desc.textContent =
        "内容を確認のうえ、ご入力のメールアドレスへご連絡します。受付番号をお控えください。";

      const homeLink = document.createElement("a");
      homeLink.href = "/";
      homeLink.className = "aio-submit-btn";
      homeLink.style.textDecoration = "none";
      homeLink.textContent = "トップページへ戻る";

      wrap.appendChild(badge);
      wrap.appendChild(title);
      wrap.appendChild(box);
      wrap.appendChild(desc);
      wrap.appendChild(homeLink);
      panel.appendChild(wrap);
    }

    // Event listeners
    function onFirstInteraction() {
      if (!hasStartedTracked) {
        hasStartedTracked = true;
        trackAnalyticsEvent("contact_start", { context: pageContext });
      }
    }

    form.addEventListener("focusin", onFirstInteraction, { once: true });
    form.addEventListener("change", onFirstInteraction, { once: true });

    // IME composition tracking (Section 6.1)
    form.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    form.addEventListener("compositionend", () => {
      isComposing = false;
    });

    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.isComposing || isComposing || e.keyCode === 229)) {
        e.preventDefault();
        return;
      }
      if (
        e.key === "Enter" &&
        e.target &&
        e.target.tagName !== "TEXTAREA" &&
        e.target.tagName !== "BUTTON" &&
        e.target.tagName !== "SUMMARY" &&
        e.target.tagName !== "A"
      ) {
        // Allow Enter to submit when not composing in single-line inputs
      }
    });

    categoryRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        syncCategoryVisuals();
        validateSingleFieldIfTouched("category");
        validateSingleFieldIfTouched("service");
      });
      radio.addEventListener("focus", () => {
        const opt = radio.closest(".aio-category-option");
        if (opt) opt.classList.add("is-focused");
      });
      radio.addEventListener("blur", () => {
        const opt = radio.closest(".aio-category-option");
        if (opt) opt.classList.remove("is-focused");
      });
    });

    if (serviceSelect) {
      serviceSelect.addEventListener("change", () => {
        const cat = getSelectedCategory();
        if (cat === "product") {
          rememberedProductService = serviceSelect.value;
        } else if (cat === "security") {
          rememberedSecurityService = serviceSelect.value;
        }
        updatePresetBanner(cat);
        validateSingleFieldIfTouched("service");
      });
    }

    if (organizationInput) {
      organizationInput.addEventListener("input", () =>
        validateSingleFieldIfTouched("organization")
      );
    }
    if (nameInput) {
      nameInput.addEventListener("input", () =>
        validateSingleFieldIfTouched("name")
      );
    }
    if (emailInput) {
      emailInput.addEventListener("input", () =>
        validateSingleFieldIfTouched("email")
      );
    }
    if (messageInput) {
      messageInput.addEventListener("input", () => {
        updateCharCounter();
        validateSingleFieldIfTouched("message");
      });
    }
    if (referenceInput) {
      referenceInput.addEventListener("input", () =>
        validateSingleFieldIfTouched("reference")
      );
    }
    if (phoneInput) {
      phoneInput.addEventListener("input", () =>
        validateSingleFieldIfTouched("phone")
      );
    }
    if (privacyCheckbox) {
      privacyCheckbox.addEventListener("change", () =>
        validateSingleFieldIfTouched("privacyAccepted")
      );
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isSubmitting || isComposing) return;

      hasAttemptedSubmit = true;
      showStatusBanner("", "");

      const clientErrors = computeValidationErrors();
      Object.keys(FIELD_CONFIG).forEach((field) => {
        const err = clientErrors[field] || "";
        if (err) touchedErrors.add(field);
        setFieldError(field, err);
      });

      if (Object.keys(clientErrors).length > 0) {
        renderErrorSummary(clientErrors, true);
        announceStatus("入力内容に確認が必要な項目があります。");
        trackAnalyticsEvent("contact_validation_error", {
          context: pageContext,
          category: getSelectedCategory() || "unselected",
        });
        return;
      }

      renderErrorSummary({}, false);

      // Resolve Turnstile token (or test token hook in automated browser verification)
      const effectiveToken =
        turnstileToken || window.__AIO_TURNSTILE_TEST_TOKEN__ || "";

      if (!effectiveToken) {
        if (turnstileUnavailable) {
          showStatusBanner(
            "不正送信防止の確認が利用できないため、フォームから送信できません。お手数ですが support@ai-orchestration.jp までメールでご連絡ください。",
            "error"
          );
          announceStatus("不正送信防止の確認が利用できません。");
          return;
        }
        showStatusBanner(
          "不正送信防止の確認が完了していません。確認チェックを行ったうえで、もう一度送信してください。",
          "warning"
        );
        announceStatus("不正送信防止の確認を行ってください。");
        return;
      }

      const payload = buildPayload(effectiveToken);
      const idempotencyKey = getOrRotateIdempotencyKey(payload);

      setFormEditingLocked(true);
      announceStatus("送信しています…");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response;
      try {
        response = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timeoutId);
        setFormEditingLocked(false);
        showStatusBanner(
          "受付結果を確認できませんでした。入力内容を保持しています。もう一度送信すると受付状況を確認します。",
          "warning"
        );
        announceStatus(
          "受付結果を確認できませんでした。もう一度送信すると受付状況を確認します。"
        );
        trackAnalyticsEvent("contact_submit_failure", {
          context: pageContext,
          category: payload.category,
          error_code: "network_or_timeout",
        });
        return;
      }
      clearTimeout(timeoutId);

      let body = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }

      if ((response.status === 200 || response.status === 201) && body.receiptId) {
        if (!hasSubmittedTracked) {
          hasSubmittedTracked = true;
          trackAnalyticsEvent("contact_submit_success", {
            context: pageContext,
            category: payload.category,
          });
        }

        const receiptData = {
          receiptId: String(body.receiptId),
          receivedAt: String(body.receivedAt || new Date().toISOString()),
        };

        try {
          window.sessionStorage.setItem(
            RECEIPT_STORAGE_KEY,
            JSON.stringify(receiptData)
          );
          window.location.assign("/thanks.html");
          return;
        } catch {
          setFormEditingLocked(false);
          renderInlineReceiptFallback(receiptData.receiptId);
          return;
        }
      }

      setFormEditingLocked(false);

      if (response.status === 422 && body.fieldErrors) {
        const serverFieldErrors = body.fieldErrors;
        Object.keys(FIELD_CONFIG).forEach((field) => {
          const msg = serverFieldErrors[field] || "";
          if (msg) touchedErrors.add(field);
          setFieldError(field, msg);
        });
        renderErrorSummary(serverFieldErrors, true);
        announceStatus("入力内容をご確認ください。");
        trackAnalyticsEvent("contact_validation_error", {
          context: pageContext,
          category: payload.category,
        });
        return;
      }

      if (response.status === 409) {
        // Rotate key on idempotency conflict so next submission succeeds as a new inquiry
        activeIdempotencyKey = generateUuidV4();
        showStatusBanner(
          "入力内容が変更されたため、送信キーを更新しました。もう一度「この内容で送信する」を押してください。",
          "warning"
        );
        announceStatus("もう一度送信ボタンを押してください。");
        return;
      }

      if (response.status === 429) {
        const retryHeader = response.headers.get("Retry-After");
        const retrySec = Number(body.retryAfterSeconds || retryHeader || 60);
        const waitText =
          Number.isFinite(retrySec) && retrySec > 0
            ? "（目安：約" + Math.ceil(retrySec / 60) + "分後）"
            : "";
        showStatusBanner(
          "短時間に送信が続いています。少し時間をおいてお試しください。" +
            waitText,
          "warning"
        );
        announceStatus("短時間に送信が続いています。少し時間をおいてお試しください。");
        trackAnalyticsEvent("contact_submit_failure", {
          context: pageContext,
          category: payload.category,
          error_code: "rate_limited",
        });
        return;
      }

      if (response.status === 403) {
        turnstileToken = "";
        if (
          window.turnstile &&
          turnstileWidgetId !== null &&
          typeof window.turnstile.reset === "function"
        ) {
          try {
            window.turnstile.reset(turnstileWidgetId);
          } catch {
            // ignore
          }
        }
        showStatusBanner(
          "確認の有効期限が切れたか、認証を確認できませんでした。もう一度確認して送信してください。",
          "error"
        );
        announceStatus("確認の有効期限が切れました。もう一度確認してください。");
        trackAnalyticsEvent("contact_submit_failure", {
          context: pageContext,
          category: payload.category,
          error_code: "verification_failed",
        });
        return;
      }

      // 503 or other server error: preserve inputs and idempotency key for safe retry
      showStatusBanner(
        "送信を完了できませんでした。時間をおいて、もう一度お試しください。お急ぎの場合は support@ai-orchestration.jp までご連絡ください。",
        "error"
      );
      announceStatus("送信を完了できませんでした。時間をおいて、もう一度お試しください。");
      trackAnalyticsEvent("contact_submit_failure", {
        context: pageContext,
        category: payload.category,
        error_code: body.code || "server_error",
      });
    });

    // Initialize UI state and unlock submit button
    applyInitialSelection();
    updateCharCounter();
    setupTurnstileLifecycle();

    if (jsFallbackBox) {
      jsFallbackBox.hidden = true;
    }
    if (preparingNote) {
      preparingNote.hidden = true;
    }
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const sections = document.querySelectorAll(".aio-contact");
    sections.forEach(initContactSection);
  });
})();

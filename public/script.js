/**
 * AI Orchestration Inc. - Interactive Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Header scroll effect
  const siteHeader = document.getElementById('siteHeader');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      siteHeader.classList.add('scrolled');
    } else {
      siteHeader.classList.remove('scrolled');
    }
  });

  // 2. Mobile Nav Toggle
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('open');
      mainNav.classList.toggle('active');
    });

    // Close mobile nav when link clicked
    const navLinks = mainNav.querySelectorAll('a');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        navToggle.classList.remove('open');
        mainNav.classList.remove('active');
      });
    });
  }

  // 3. FAQ Accordion
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    if (questionBtn) {
      questionBtn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        
        // Optional: close other open items
        faqItems.forEach(other => {
          if (other !== item) {
            other.classList.remove('open');
            const btn = other.querySelector('.faq-question');
            if (btn) btn.setAttribute('aria-expanded', 'false');
          }
        });

        if (isOpen) {
          item.classList.remove('open');
          questionBtn.setAttribute('aria-expanded', 'false');
        } else {
          item.classList.add('open');
          questionBtn.setAttribute('aria-expanded', 'true');
        }
      });
    }
  });

  // 4. Contact Form Type Radio Cards
  const radioCards = document.querySelectorAll('.type-radio-card');
  radioCards.forEach(card => {
    card.addEventListener('click', () => {
      radioCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const input = card.querySelector('input[type="radio"]');
      if (input) input.checked = true;
    });
  });

  // 5. Contact Form Submission
  const form = document.getElementById('topContactForm');
  const feedback = document.getElementById('formFeedback');
  const submitBtn = document.getElementById('submitBtn');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      // Retrieve form values
      const selectedTypeInput = document.querySelector('input[name="inquiryType"]:checked');
      const inquiryType = selectedTypeInput ? selectedTypeInput.value : '初回技術診断（50,000円）';
      const companyName = document.getElementById('companyName').value.trim();
      const personName = document.getElementById('personName').value.trim();
      const email = document.getElementById('email').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const message = document.getElementById('message').value.trim();

      // Reset feedback
      feedback.style.display = 'none';
      feedback.className = 'form-feedback';
      feedback.innerHTML = '';

      // Simple validation
      if (!companyName || !personName || !email || !message) {
        showFeedback('error', '必須項目（ご相談種別、貴社名、お名前、メールアドレス、ご相談内容）をすべてご入力ください。');
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        showFeedback('error', '正しいメールアドレスの形式でご入力ください。');
        return;
      }

      // Cloudflare form delivery will be connected later. Create a mail draft only.
      const recipient = 'yamamoto@ai-orchestration.jp';
      const mailSubject = encodeURIComponent(`【Web問合せ】${inquiryType} - ${companyName} ${personName}様`);
      const mailBody = encodeURIComponent(
        `種別: ${inquiryType}\n貴社名: ${companyName}\nお名前: ${personName}\nメール: ${email}\n電話: ${phone}\n\n相談内容:\n${message}`
      );
      const mailtoUrl = `mailto:${recipient}?subject=${mailSubject}&body=${mailBody}`;
      const tooLong = mailtoUrl.length > 7000;
      showFeedback('success', tooLong
        ? '入力内容が長いため、メール本文への自動転記は行いません。入力内容をコピーし、下記の宛先へお送りください。まだ送信されていません。'
        : 'まだ送信されていません。メールアプリで内容を確認して送信してください。アプリが開かない場合は、入力内容をコピーし、下記の宛先へお送りください。');
      const addressLink = document.createElement('a');
      addressLink.href = `mailto:${recipient}`;
      addressLink.textContent = recipient;
      addressLink.style.textDecoration = 'underline';
      feedback.append(document.createElement('br'), addressLink);
      if (!tooLong) window.location.href = mailtoUrl;
      // Keep all input intact; opening a mail application does not confirm delivery.
    });
  }

  function showFeedback(type, message) {
    feedback.style.display = 'block';
    feedback.className = `form-feedback ${type}`;
    feedback.textContent = message;
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 6. Privacy Policy Modal
  const privacyModal = document.getElementById('privacyModal');
  const openPrivacyBtn = document.getElementById('openPrivacyModal');
  const footerPrivacyBtn = document.getElementById('footerPrivacyLink');
  const closePrivacyBtn = document.getElementById('closePrivacyModal');

  const openModal = () => {
    if (privacyModal) privacyModal.classList.add('active');
  };
  const closeModal = () => {
    if (privacyModal) privacyModal.classList.remove('active');
  };

  if (openPrivacyBtn) openPrivacyBtn.addEventListener('click', openModal);
  if (footerPrivacyBtn) footerPrivacyBtn.addEventListener('click', openModal);
  if (closePrivacyBtn) closePrivacyBtn.addEventListener('click', closeModal);

  if (privacyModal) {
    privacyModal.addEventListener('click', (e) => {
      if (e.target === privacyModal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && privacyModal && privacyModal.classList.contains('active')) {
      closeModal();
    }
  });
});

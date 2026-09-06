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

  // 4. Navigate only after our embedded Tally form confirms submission.
  const contactFrame = document.getElementById('contactTallyFrame');
  if (contactFrame) {
    window.addEventListener('message', (event) => {
      if (event.origin !== 'https://tally.so' || event.source !== contactFrame.contentWindow) return;
      let message = event.data;
      if (typeof message === 'string') {
        try { message = JSON.parse(message); } catch { return; }
      }
      if (message?.event !== 'Tally.FormSubmitted' || message.payload?.formId !== 'obPAq1') return;
      window.location.assign(new URL('thanks.html', window.location.href).href);
    });
  }

  // 5. Privacy Policy Modal
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

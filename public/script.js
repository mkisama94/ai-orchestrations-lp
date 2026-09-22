/**
 * AI Orchestration Inc. - Interactive Script
 */

/**
 * Curated Hero Photography Registry
 * Represents architectural & observational works exhibited in the Hero section.
 */
const HERO_WORKS = [
  {
    id: "001",
    tag: "PHOTO / 001",
    title: "Extinct Media Museum Tokyo",
    titleJa: "絶滅メディア博物館",
    year: "2024",
    imageWebp: "images/hero-photos/software-archive.webp",
    imageJpg: "images/hero-photos/software-archive.jpg",
    alt: "ソフトウェアアーカイブ、東京（2024）- レトロPC・Mac・名作ソフトウェア展示",
    position: "50% 48%",
    photographer: "M. Yamamoto",
    journalUrl: null
  },
  {
    id: "002",
    tag: "PHOTO / 002",
    title: "Showa no Mori Museum",
    titleJa: "昭和の杜博物館",
    year: "2025",
    imageWebp: "images/hero-photos/scrap-robotics.webp",
    imageJpg: "images/hero-photos/scrap-robotics.jpg",
    alt: "スクラップロボティクスアート（2025）- 金属造形・ロボット彫刻",
    position: "50% 50%",
    photographer: "M. Yamamoto",
    journalUrl: null
  },
  {
    id: "003",
    tag: "PHOTO / 003",
    title: "Nippon Institute of Technology",
    titleJa: "日本工業大学 工業技術博物館",
    year: "2025",
    imageWebp: "images/hero-photos/aviation-hangar.webp",
    imageJpg: "images/hero-photos/aviation-hangar.jpg",
    alt: "航空機とトラス構造（2025）- 初期航空機とハンガー建築構造",
    position: "50% 38%",
    photographer: "M. Yamamoto",
    journalUrl: null
  }
];
window.HERO_WORKS = HERO_WORKS;

function initHeroSlideshow() {
  const frame = document.getElementById('heroPhotoFrame');
  if (!frame) return;

  const slides = frame.querySelectorAll('.hero-photo-slide');
  const prevBtn = document.getElementById('heroSlidePrev');
  const nextBtn = document.getElementById('heroSlideNext');
  const progressBar = document.getElementById('heroProgressBar');
  const indicators = document.querySelectorAll('.hero-indicator-btn');
  const captionMain = document.getElementById('heroCaptionMain');
  const captionTag = document.getElementById('heroCaptionTag');
  const captionTitle = document.getElementById('heroCaptionTitle');
  const captionYear = document.getElementById('heroCaptionYear');

  if (slides.length <= 1) return;

  let currentIndex = 0;
  let isPaused = false;
  let timer = null;
  const SLIDE_DURATION = 6500; // 6.5s calm gallery pace

  function updateProgress() {
    if (!progressBar) return;
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    void progressBar.offsetWidth; // force reflow
    if (!isPaused) {
      progressBar.style.transition = `width ${SLIDE_DURATION}ms linear`;
      progressBar.style.width = '100%';
    }
  }

  function goToSlide(index) {
    if (index === currentIndex) return;
    currentIndex = (index + slides.length) % slides.length;
    const data = HERO_WORKS[currentIndex];

    // Toggle active slide
    slides.forEach((s, idx) => {
      s.classList.toggle('active', idx === currentIndex);
    });

    // Update indicator buttons
    indicators.forEach((btn, idx) => {
      const isActive = idx === currentIndex;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Animate caption update
    if (captionMain && data) {
      captionMain.classList.add('fade-out');
      setTimeout(() => {
        if (captionTag) captionTag.textContent = data.tag;
        if (captionTitle) captionTitle.textContent = data.title;
        if (captionYear) captionYear.textContent = data.year;
        captionMain.classList.remove('fade-out');
      }, 150);
    }

    resetTimer();
  }

  function nextSlide() {
    goToSlide(currentIndex + 1);
  }

  function prevSlide() {
    goToSlide(currentIndex - 1);
  }

  function resetTimer() {
    clearInterval(timer);
    updateProgress();
    if (!isPaused) {
      timer = setInterval(nextSlide, SLIDE_DURATION);
    }
  }

  if (prevBtn) prevBtn.addEventListener('click', () => { prevSlide(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { nextSlide(); });

  indicators.forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (!isNaN(idx)) goToSlide(idx);
    });
  });

  // Pause on mouse hover for mindful observation
  frame.addEventListener('mouseenter', () => {
    isPaused = true;
    clearInterval(timer);
    if (progressBar) {
      const computedWidth = window.getComputedStyle(progressBar).width;
      progressBar.style.transition = 'none';
      progressBar.style.width = computedWidth;
    }
  });

  frame.addEventListener('mouseleave', () => {
    isPaused = false;
    resetTimer();
  });

  // Touch swipe
  let touchStartX = 0;
  let touchEndX = 0;
  frame.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  frame.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) > 40) {
      if (diff < 0) nextSlide();
      else prevSlide();
    }
  }, { passive: true });

  // Keyboard controls
  frame.setAttribute('tabindex', '0');
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prevSlide();
    else if (e.key === 'ArrowRight') nextSlide();
  });

  resetTimer();
}

document.addEventListener('DOMContentLoaded', () => {
  // 0. Hero Slideshow
  initHeroSlideshow();
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

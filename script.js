document.addEventListener('DOMContentLoaded', () => {
  
  // Header Scroll State
  const header = document.getElementById('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // Mobile Menu Navigation
  const burger = document.getElementById('burger');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link, .nav-cta');

  burger.addEventListener('click', () => {
    burger.classList.toggle('active');
    navMenu.classList.toggle('active');
    document.body.classList.toggle('menu-open');
  });

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('active');
      navMenu.classList.remove('active');
      document.body.classList.remove('menu-open');
    });
  });

  // Intersection Observer for Reveal Animations
  const revealElements = document.querySelectorAll('.reveal');
  
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target); // Trigger only once
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -30px 0px'
  });

  revealElements.forEach(element => {
    revealObserver.observe(element);
  });

  // Consulting Steps (Process) Sequential Highlighting on Scroll
  const processList = document.querySelector('.process-list');
  const steps = document.querySelectorAll('.process-step');
  
  if (processList && steps.length > 0) {
    const processObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Highlight steps sequentially
          steps.forEach((step, index) => {
            setTimeout(() => {
              step.style.borderColor = 'var(--accent)';
              step.style.transform = 'translateY(-4px)';
              step.style.boxShadow = 'var(--shadow-md)';
              
              const num = step.querySelector('.process-step-num');
              if (num) {
                num.style.backgroundColor = 'var(--accent)';
                num.style.color = 'white';
              }
              
              // Reset after brief highlight
              setTimeout(() => {
                step.style.borderColor = '';
                step.style.transform = '';
                step.style.boxShadow = '';
                if (num) {
                  num.style.backgroundColor = '';
                  num.style.color = '';
                }
              }, 1000);
            }, index * 300);
          });
        }
      });
    }, {
      threshold: 0.3
    });

    processObserver.observe(processList);
  }

  // Contact Form Submission Handling
  const contactForm = document.getElementById('contactForm');
  const submitBtn = document.getElementById('submitBtn');
  const formStatus = document.getElementById('formStatus');

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      // Reset status
      formStatus.style.display = 'none';
      formStatus.className = 'form-status';
      formStatus.textContent = '';

      // Form validation
      const type = document.getElementById('inquiryType').value;
      const company = document.getElementById('companyName').value.trim();
      const name = document.getElementById('userName').value.trim();
      const email = document.getElementById('userEmail').value.trim();
      const message = document.getElementById('message').value.trim();

      if (!type || !company || !name || !email || !message) {
        showStatus('error', '必須項目をすべて入力してください。');
        return;
      }

      if (!validateEmail(email)) {
        showStatus('error', '有効なメールアドレスを入力してください。');
        return;
      }

      // Submission UI state
      submitBtn.disabled = true;
      submitBtn.textContent = '送信中...';

      // Mock API Post
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = '送信する';
        
        // Success feedback
        showStatus('success', 'お問い合わせ内容が送信されました。内容を確認の上、担当者よりご連絡いたします。');
        contactForm.reset();
      }, 1500);
    });
  }

  function validateEmail(email) {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
  }

  function showStatus(type, message) {
    formStatus.style.display = 'block';
    formStatus.classList.add(type);
    formStatus.textContent = message;
  }
});

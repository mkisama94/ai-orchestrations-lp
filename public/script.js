'use strict';

// Set an approved HTTPS form endpoint before accepting live inquiries.
// An empty endpoint deliberately never reports a successful submission.
const CONTACT_ENDPOINT = '';
const CONTACT_EMAIL = 'yamamoto@ai-orchestration.jp';

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.site-nav');
const closeMenu = () => {
  menuButton.setAttribute('aria-expanded', 'false');
  nav.classList.remove('open');
};
menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  nav.classList.toggle('open', !isOpen);
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    closeMenu();
    menuButton.focus();
  }
});
window.matchMedia('(min-width: 641px)').addEventListener('change', closeMenu);

document.querySelectorAll('[data-inquiry]').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('inquiryType').value = link.dataset.inquiry;
  });
});

const privacyDialog = document.getElementById('privacyDialog');
const confirmDialog = document.getElementById('confirmDialog');
const openDialog = dialog => {
  dialog.showModal();
  document.body.classList.add('dialog-open');
};
document.querySelectorAll('#privacyOpen, [data-privacy]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    openDialog(privacyDialog);
  });
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
});

const form = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');
const confirmStatus = document.getElementById('confirmStatus');
const sendButton = document.getElementById('sendBtn');
const fields = [
  ['inquiryType', 'ご相談の種類'],
  ['companyName', '会社名・団体名'],
  ['userName', 'お名前'],
  ['userEmail', 'メールアドレス'],
  ['message', 'ご相談内容'],
];
if (CONTACT_ENDPOINT) {
  sendButton.textContent = 'この内容で送信する ↗';
  document.querySelectorAll('.email-handoff-note').forEach(note => { note.hidden = true; });
}
let sending = false;
const mailBody = () => fields.map(([id, label]) => {
  const field = document.getElementById(id);
  const value = field.tagName === 'SELECT' ? field.selectedOptions[0].textContent : field.value;
  return `${label}：\n${value}`;
}).join('\n\n');
const setStatus = (element, message, kind = 'error') => {
  element.textContent = message;
  element.className = `form-status ${kind}`;
};

document.getElementById('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(mailBody());
    setStatus(confirmStatus, '内容をコピーしました。メールに貼り付けてお送りください。', 'success');
  } catch {
    setStatus(confirmStatus, 'コピーできませんでした。表示されている内容を選択してコピーしてください。');
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (sending) return;
  for (const [id] of fields) {
    const field = document.getElementById(id);
    if (field.tagName !== 'SELECT') field.value = field.value.trim();
  }
  if (!form.reportValidity()) return;
  formStatus.textContent = '';
  confirmStatus.textContent = '';
  const preview = document.getElementById('confirmFields');
  preview.replaceChildren();
  for (const [id, label] of fields) {
    const field = document.getElementById(id);
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = field.tagName === 'SELECT'
      ? field.selectedOptions[0].textContent : field.value;
    row.append(term, detail);
    preview.append(row);
  }
  openDialog(confirmDialog);
});

sendButton.addEventListener('click', async () => {
  if (sending || !form.reportValidity()) return;
  if (!CONTACT_ENDPOINT) {
    const subject = `【ご相談】${document.getElementById('companyName').value}`;
    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody())}`;
    if (mailto.length > 7000) {
      setStatus(confirmStatus, '内容が長いため、「内容をコピー」で本文をコピーし、メールでお送りください。送信先：' + CONTACT_EMAIL);
      return;
    }
    window.location.href = mailto;
    setStatus(confirmStatus, 'まだ送信は完了していません。メールアプリで内容を確認し、送信してください。', 'success');
    return;
  }
  if (document.getElementById('website').value) {
    setStatus(confirmStatus, '送信できませんでした。入力内容をご確認ください。');
    return;
  }
  sending = true;
  sendButton.disabled = true;
  sendButton.textContent = '送信中…';
  confirmStatus.textContent = '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const payload = Object.fromEntries(new FormData(form));
    const response = await fetch(CONTACT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Submission failed');
    const result = await response.json();
    if (result.success !== true) throw new Error('Submission was not confirmed');
    confirmDialog.close();
    form.reset();
    setStatus(formStatus, 'お問い合わせを受け付けました。内容を確認のうえ、ご連絡いたします。', 'success');
  } catch {
    setStatus(confirmStatus, '送信の完了を確認できませんでした。入力内容は保持されています。時間をおいて再度お試しください。');
  } finally {
    window.clearTimeout(timeout);
    sending = false;
    sendButton.disabled = false;
    sendButton.textContent = CONTACT_ENDPOINT ? 'この内容で送信する ↗' : 'メールを作成する ↗';
  }
});

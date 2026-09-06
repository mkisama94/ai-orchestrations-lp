const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function element(tagName = 'DIV') {
  const listeners = {};
  const classes = new Set();
  return {
    tagName, value: '', textContent: '', dataset: {}, children: [], listeners,
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(name, cb) { listeners[name] = cb; },
    querySelectorAll() { return []; },
    replaceChildren() { this.children = []; },
    append(...children) { this.children.push(...children); },
    showModal() { this.open = true; },
    close() { this.open = false; listeners.close?.(); },
    focus() { this.focused = true; },
  };
}

async function test() {
  const ids = {};
  for (const name of ['privacyDialog', 'confirmDialog', 'contactForm', 'formStatus', 'confirmStatus', 'sendBtn', 'copyBtn', 'confirmFields', 'inquiryType', 'companyName', 'userName', 'userEmail', 'message', 'website']) ids[name] = element();
  const menu = element('BUTTON');
  menu.setAttribute('aria-expanded', 'false');
  const nav = element('NAV');
  const cta = element('A');
  cta.dataset.inquiry = 'project';
  ids.inquiryType.tagName = 'SELECT';
  ids.inquiryType.selectedOptions = [{ textContent: '設計・開発・プロジェクト支援について' }];
  for (const name of ['companyName', 'userName', 'userEmail', 'message']) ids[name].tagName = 'INPUT';
  ids.companyName.value = ' テスト株式会社 ';
  ids.userName.value = ' 山田 太郎 ';
  ids.userEmail.value = 'test@example.com';
  ids.message.value = '<script>alert(1)</script> & 技術相談';
  ids.contactForm.reportValidity = () => true;
  const document = {
    body: element(),
    getElementById: id => ids[id],
    querySelector: name => name === '.menu-toggle' ? menu : nav,
    querySelectorAll: name => name === '[data-inquiry]' ? [cta] : name === 'dialog' ? [ids.privacyDialog, ids.confirmDialog] : [],
    createElement: tag => element(tag.toUpperCase()),
    addEventListener() {},
  };
  let copied;
  const window = { matchMedia: () => ({ addEventListener() {} }), location: { href: '' }, setTimeout, clearTimeout };
  let networkCalls = 0;
  const context = { document, window, navigator: { clipboard: { writeText: async text => { copied = text; } } }, fetch: () => { networkCalls++; throw Error('No network expected'); }, AbortController, FormData, console };
  vm.runInNewContext(fs.readFileSync('public/script.js', 'utf8'), context);
  menu.listeners.click();
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  assert(nav.classList.contains('open'));
  menu.listeners.click();
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  cta.listeners.click();
  assert.equal(ids.inquiryType.value, 'project');
  ids.contactForm.listeners.submit({ preventDefault() {} });
  assert.equal(ids.confirmDialog.open, true);
  assert.equal(ids.companyName.value, 'テスト株式会社');
  assert.equal(ids.confirmFields.children.length, 5);
  assert.equal(ids.confirmFields.children[4].children[1].textContent, '<script>alert(1)</script> & 技術相談');
  await ids.copyBtn.listeners.click();
  assert(copied.includes('技術相談'));
  await ids.sendBtn.listeners.click();
  assert(window.location.href.startsWith('mailto:yamamoto@ai-orchestration.jp?'));
  const mail = new URL(window.location.href);
  assert.equal(mail.searchParams.get('subject'), '【ご相談】テスト株式会社');
  assert(mail.searchParams.get('body').includes('<script>alert(1)</script> & 技術相談'));
  assert(ids.confirmStatus.textContent.includes('まだ送信は完了していません'));
  assert.equal(networkCalls, 0);
  window.location.href = '';
  ids.message.value = '長'.repeat(5000);
  await ids.sendBtn.listeners.click();
  assert.equal(window.location.href, '');
  assert(ids.confirmStatus.textContent.includes('内容が長いため'));
  ids.confirmDialog.close();
  assert(!document.body.classList.contains('dialog-open'));
  console.log('PASS: menu, inquiry selection, confirmation, text-only rendering, clipboard, encoded mail draft, no false success, long-message fallback.');
}
test().catch(error => { console.error(error); process.exit(1); });

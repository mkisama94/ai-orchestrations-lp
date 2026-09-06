const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function node(value = '') {
  return { value, style: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(event, fn) { this[event] = fn; }, append(...nodes) { this.children.push(...nodes); }, scrollIntoView() {} };
}
const ids = Object.fromEntries(['topContactForm', 'formFeedback', 'submitBtn', 'companyName', 'personName', 'email', 'phone', 'message'].map(id => [id, node()]));
let init;
const context = {
  document: { addEventListener(type, fn) { if (type === 'DOMContentLoaded') init = fn; },
    getElementById(id) { return ids[id] || null; }, querySelectorAll() { return []; },
    querySelector() { return { value: '初回技術診断（50,000円）' }; }, createElement() { return node(); } },
  window: { addEventListener() {}, location: { href: '' } },
};
vm.runInNewContext(fs.readFileSync('public/script.js', 'utf8'), context);
init();
const submit = () => ids.topContactForm.submit({ preventDefault() {} });
submit();
assert.equal(ids.formFeedback.className, 'form-feedback error');
ids.companyName.value = 'テスト & 会社'; ids.personName.value = '山田'; ids.email.value = 'test@example.com';
ids.message.value = '<script>alert(1)</script> 技術相談';
submit();
const url = new URL(context.window.location.href);
assert.equal(url.pathname, 'yamamoto@ai-orchestration.jp');
assert(url.searchParams.get('body').includes(ids.message.value));
assert(ids.formFeedback.textContent.includes('まだ送信されていません'));
assert(ids.message.value.length > 0);
assert.equal(ids.formFeedback.children.at(-1).textContent, 'yamamoto@ai-orchestration.jp');
context.window.location.href = '';
ids.message.value = '長'.repeat(5000);
submit();
assert.equal(context.window.location.href, '');
assert(ids.formFeedback.textContent.includes('自動転記は行いません'));
assert.equal(ids.message.value.length, 5000);
console.log('PASS: validation, correct recipient, encoding, truthful draft status, input retention, long-message fallback');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('authentication pages retain English + Thai when returning from the dashboard', () => {
  const root = { dataset: {} }, select = {}, heading = { dataset: { authText: 'title' } };
  const document = {
    documentElement: root,
    querySelector: () => heading,
    querySelectorAll: selector => selector === '[data-auth-text]' ? [heading] : selector === '[data-auth-language]' ? [select] : []
  };
  const context = vm.createContext({ document, localStorage: { getItem: () => 'en-th' } });
  const source = fs.readFileSync('auth/client.js','utf8').replace(/^import .*\r?\n/,'').replace(/\bexport /g,'');
  vm.runInContext(source + '\ntranslate();',context);
  assert.equal(root.lang,'en');
  assert.equal(root.dataset.uiLocale,'en-th');
  assert.equal(select.value,'en-th');
  assert.equal(heading.textContent,'Sign in · เข้าสู่ระบบ');
  assert.equal(document.title,'Sign in · เข้าสู่ระบบ · IQC');
  vm.runInContext("addTranslations({en:{reminderTitle:'Bot reminders'},th:{reminderTitle:'แจ้งเตือนผ่านบอต'}})",context);
  assert.equal(vm.runInContext("text('reminderTitle')",context),'Bot reminders · แจ้งเตือนผ่านบอต');
});

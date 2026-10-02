'use strict';
// All storage is synthetic. External requests (including Sheets and game API) are blocked.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.LEDGER_PLAYWRIGHT || 'playwright');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const errors = [], passes = [];
async function seed(p) {
  await p.evaluate(() => {
    localStorage.clear();
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() - 3 + 7) % 7);
    const key = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    localStorage.setItem('lag_accounts', JSON.stringify([{ id: 'a1', name: '테스트 A' }, { id: 'a2', name: '테스트 B' }]));
    localStorage.setItem('lag_week_' + key, JSON.stringify({ target: 1500000, carriedEarned: 1100000, carriedByAccount: { a1: 300000, a2: 800000 }, entries: [] }));
    localStorage.setItem('lag_settings', JSON.stringify({ baseTarget: 1500000, exchangeRate: 750, itemTarget: 830000 }));
    localStorage.setItem('lag_items', JSON.stringify([{ id: 'i1', name: '융화 재료', price: 243, qty: 8900 }, { id: 'i2', name: '보석', price: 315998, qty: 6 }]));
  });
  await p.reload();
}
const week = p => p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('lag_week_')))));
async function sale(p, amount) {
  await p.locator('#entry-amount').fill(String(amount));
  await p.evaluate(() => __gl.addEntry());
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.LEDGER_BROWSER ? { executablePath: process.env.LEDGER_BROWSER } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 950 } });
    await context.route('**/*', r => r.request().url().startsWith('https://ledger.test/') ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort());
    async function newPage() { const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto('https://ledger.test/'); return p; }
    const p = await newPage();
    await seed(p);
    for (const bad of ['-10', '0', '40', '1e2', '1..2', 'abc10', '1.12345', '9007199254740992']) {
      await sale(p, bad); assert.equal((await week(p)).entries.length, 0, 'reject ' + bad);
      assert.ok(await p.locator('#entry-amount').evaluate(el => el.validationMessage));
    }
    await sale(p, '2.5'); assert.equal((await week(p)).entries[0].amount, 25000);
    passes.push('cycle 1: invalid/oversell inputs rejected, valid decimal accepted');
    await seed(p);
    const p2 = await newPage();
    await sale(p, 10); await sale(p2, 5);
    assert.deepEqual((await week(p)).entries.map(e => e.amount), [100000]);
    assert.match(await p2.locator('.error-bar').first().textContent(), /이번 입력은 저장하지/);
    await sale(p2, 5); assert.deepEqual((await week(p)).entries.map(e => e.amount), [50000, 100000]);
    await p.reload(); await p2.reload();
    await Promise.all([sale(p, 1), sale(p2, 2)]);
    assert.equal((await week(p)).entries.length, 3, 'one serialized write succeeds; stale concurrent write rejected');
    await p2.close();
    passes.push('cycle 1: stale-tab and simultaneous-tab writes do not lose history');
    await seed(p);
    await p.locator('#entry-account').selectOption('a2');
    await p.locator('#entry-amount').fill('10');
    assert.match(await p.locator('#sale-preview').textContent(), /보유 70만.*목표 140만/);
    await p.evaluate(() => __gl.addEntry());
    assert.equal(await p.locator('#entry-account').inputValue(), 'a2');
    await p.reload(); await p.evaluate(() => __gl.undoLedger());
    assert.equal((await week(p)).entries.length, 0);
    assert.equal((await week(p)).target, 1500000);
    await p.locator('.ar-balance').first().click();
    await p.locator('#carried-earned-input').fill('45');
    assert.match(await p.locator('#balance-preview').textContent(), /30만.*45만.*\+15만/);
    await p.evaluate(() => __gl.commitCarriedEarned());
    assert.equal((await week(p)).entries[0].amount, 150000);
    await p.evaluate(() => __gl.undoLedger()); assert.equal((await week(p)).entries.length, 0);
    for (let i = 0; i < 6; i++) await sale(p, 1);
    assert.equal((await week(p)).undo.length, 5);
    for (let i = 0; i < 5; i++) await p.evaluate(() => __gl.undoLedger());
    assert.equal((await week(p)).entries.length, 1);
    passes.push('cycle 2: sale/balance previews, selected account, persisted five-step undo');
    await p.evaluate(() => localStorage.clear()); await p.reload();
    assert.match(await p.locator('.ar-summary').textContent(), /목표 설정 필요/);
    assert.doesNotMatch(await p.locator('.ar-summary').textContent(), /목표 확보 완료/);
    await p.getByRole('button', { name: '기본 목표 설정', exact: true }).click();
    await p.locator('#base-input').fill('150'); await p.evaluate(() => __gl.saveBase());
    assert.equal((await week(p)).target, 1500000);
    await seed(p);
    await p.evaluate(async () => {
      const original = URL.createObjectURL;
      URL.createObjectURL = blob => { window.testBackup = blob; return original(blob); };
      await __gl.exportJSON();
    });
    const backup = await p.evaluate(() => window.testBackup.text());
    assert.equal(Object.hasOwn(JSON.parse(backup).settings, 'itemPriceApiKey'), false);
    assert.ok(await p.evaluate(() => localStorage.getItem('lag_backupRequestedAt')));
    const upload = async data => p.locator('#import-file-input').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
    const before = await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    await upload({ accounts: [] });
    await p.waitForFunction(() => document.querySelector('.error-bar')?.textContent.includes('형식'));
    assert.equal(await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))), before);
    let acceptImport = false; const dialogs = [];
    p.on('dialog', async d => { dialogs.push(d.message()); await (acceptImport ? d.accept() : d.dismiss()); });
    await upload(backup); await p.waitForFunction(() => !document.querySelector('#import-file-input').value);
    await p.waitForTimeout(100); assert.equal((await week(p)).target, 1500000);
    assert.match(dialogs.at(-1), /계정 2개.*아이템 2개/);
    const changed = JSON.parse(backup); changed.accounts[0].name = '복원 테스트'; changed.settings.itemPriceApiKey = 'untrusted-import-key'; changed.settings.sheetUrl = 'https://untrusted.invalid/';
    acceptImport = true;
    await p.evaluate(() => {
      const original = Storage.prototype.setItem;
      let calls = 0;
      Storage.prototype.setItem = function(k, v) { if (++calls === 2) throw new DOMException('Test quota', 'QuotaExceededError'); return original.call(this, k, v); };
    });
    await upload(changed); await p.waitForFunction(() => document.querySelector('.error-bar')?.textContent.includes('복구'));
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('lag_accounts'))[0].name), '테스트 A');
    await p.reload(); await upload(changed);
    await p.waitForFunction(() => document.querySelector('.ar-name')?.textContent.includes('복원 테스트'));
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('lag_settings')).itemPriceApiKey), '');
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('lag_settings')).sheetUrl), '');
    passes.push('cycle 3: first goal, export, malformed/cancelled import, quota rollback, preview and safe import');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passes, runtimeErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

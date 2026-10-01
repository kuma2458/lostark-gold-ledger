'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const expected = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
// Normalize checkout line endings; deployed content must otherwise match exactly.
const hash = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const expectedHash = hash(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const url = 'https://kuma2458.github.io/lostark-gold-ledger/';
(async () => {
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const response = await fetch(url + '?check=' + Date.now(), {signal: AbortSignal.timeout(10000), cache: 'no-store'});
      const html = await response.text();
      if (response.ok && hash(html) === expectedHash) {
        console.log('LIVE v' + expected + ' verified; HTML matches release.');
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Verified v' + expected + ': ' + url + '\n');
        return;
      }
      console.log('Waiting for release v' + expected + ' (HTTP ' + response.status + ', attempt ' + attempt + ')');
    } catch (_) { console.log('Live verification request unavailable; retrying.'); }
    if (attempt < 12) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Deployment ran, but the live HTML did not match this release. Check Pages deployment and cache.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

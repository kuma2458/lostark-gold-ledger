'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const errors = [];
function check(ok, message) { if (!ok) errors.push(message); }
check(/^\d+\.\d+\.\d+$/.test(version), 'Invalid version');
check(html.includes('name="application-version" content="' + version + '"'), 'Version mismatch');
for (const [pattern, message] of [
  [/data:image\//i, 'Embedded image found'],
  [/https:\/\/script\.google\.com\/macros\/s\/(?!\.\.\.)[A-Za-z0-9_-]{10,}/, 'Deployed script URL found'],
  [/https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,}/, 'Spreadsheet link found'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'JWT-like token found'],
  [/[A-Z]:[\\/]Users[\\/][^\s"'<>]+/i, 'User filesystem path found'],
  [/itemPriceApiKey\s*:\s*["'][^"']+["']/, 'Nonempty default API key'],
  [/sheetUrl\s*:\s*["'][^"']+["']/, 'Nonempty default sync URL']
]) check(!pattern.test(html), message);
check(/var dashboardPortraits = \[\];/.test(html), 'Portraits must be empty');
check(/var dashboardPhotoNames = \[\];/.test(html), 'Portrait names must be empty');
check(/var DEFAULT_TARGET = 0;/.test(html), 'Initial target must be zero');
check(/cardBill: 0/.test(html) && /cashOnHand: 0/.test(html), 'Initial finance values must be zero');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
check(scripts.length > 0, 'Missing script');
scripts.forEach((match, i) => {
  try { new Function(match[1]); } catch (e) { errors.push('Script ' + i + ': ' + e.message); }
});
const allowed = new Set(['.gitignore', '.gitattributes', 'index.html', 'README.md', 'CHANGELOG.md', 'VERSION', 'scripts/check-release.cjs']);
try {
  cp.execFileSync('git', ['ls-files', '-z'], {cwd:root, encoding:'utf8'}).split('\0').filter(Boolean)
    .forEach(file => check(allowed.has(file), 'Unexpected tracked file: ' + file));
} catch (_) { errors.push('Git repository required'); }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Release ' + version + ': privacy baseline and JavaScript syntax passed.');


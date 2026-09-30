// Usage: node scripts/bump-version.mjs [minor|major|X.Y]
// Updates every place index.html shows the version, and the footer date.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../index.html', import.meta.url);
let html = readFileSync(file, 'utf8');
const cur = /window\.TG_VERSION='(\d+)\.(\d+)'/.exec(html);
if (!cur) { console.error('TG_VERSION not found'); process.exit(1); }
const arg = process.argv[2] || 'minor';
let next;
if (/^\d+\.\d+$/.test(arg)) next = arg;
else if (arg === 'major') next = `${+cur[1] + 1}.0`;
else next = `${cur[1]}.${+cur[2] + 1}`;
const old = `${cur[1]}.${cur[2]}`;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Asia/Taipei

const edits = [
  [/window\.TG_VERSION='[\d.]+'/, `window.TG_VERSION='${next}'`],
  [/%3Ev[\d.]+%3C\/text%3E/, `%3Ev${next}%3C/text%3E`],                 // favicon
  [/(<div class="login-footer">TripGo v)[\d.]+/, `$1${next}`],
  [/TripGo v[\d.]+ &nbsp;·&nbsp; \d{4}-\d{2}-\d{2}/, `TripGo v${next} &nbsp;·&nbsp; ${today}`],
  [/\/\/ TripGo v[\d.]+/, `// TripGo v${next}`],
  [/ctx\.fillText\('v[\d.]+'/, `ctx.fillText('v${next}'`],               // share image
];
for (const [re, rep] of edits) {
  if (!re.test(html)) { console.error('pattern not found:', re); process.exit(1); }
  html = html.replace(re, rep);
}
writeFileSync(file, html);
console.log(`v${old} → v${next}`);

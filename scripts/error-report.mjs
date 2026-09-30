// Prints a Markdown summary of tripgo/errors from the last 24h (nothing if none).
const db = process.env.DB_URL || 'https://tripgo-6b6ed-default-rtdb.firebaseio.com';
const since = Date.now() - 24 * 3600e3;
const res = await fetch(`${db}/tripgo/errors.json`);
if (!res.ok) { console.error(`Firebase read failed: ${res.status} ${await res.text()}`); process.exit(1); }
const all = Object.values((await res.json()) || {}).filter((e) => e && e.ts >= since);
if (!all.length) process.exit(0);
const groups = new Map();
for (const e of all) {
  const g = groups.get(e.msg) || { n: 0, ver: new Set(), ua: new Set(), sample: e };
  g.n++; g.ver.add(e.ver); g.ua.add((e.ua || '').replace(/\).*$/, ')'));
  groups.set(e.msg, g);
}
const out = [`過去 24 小時共 ${all.length} 筆錯誤，${groups.size} 種。\n`];
for (const [msg, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
  out.push(`### ${msg}`, `- 次數：${g.n}　版本：${[...g.ver].join(', ')}`,
    `- 位置：${g.sample.src || '?'}:${g.sample.line}:${g.sample.col}`,
    `- 裝置：${[...g.ua].slice(0, 3).join(' / ')}`, '```', (g.sample.stack || '').slice(0, 1200), '```', '');
}
console.log(out.join('\n'));

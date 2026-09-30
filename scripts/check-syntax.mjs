// Parse every inline <script> in index.html; exit 1 on any syntax error.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  n++;
  const line = html.slice(0, m.index).split('\n').length;
  try { new vm.Script(m[1], { filename: `index.html:script#${n}@line${line}` }); }
  catch (e) { bad++; console.error(`✗ script #${n} (starts line ${line}): ${e.message}`); }
}
console.log(bad ? `${bad}/${n} inline scripts failed` : `✓ ${n} inline scripts OK`);
process.exit(bad ? 1 : 0);

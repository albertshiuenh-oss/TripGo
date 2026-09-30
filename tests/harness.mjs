// Shared setup: swaps every external service for a local stub and records
// JS errors, so tests run offline and deterministically.
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const FIREBASE_STUB = read('./stubs/firebase-stub.js');
const MAPS_STUB = read('./stubs/maps-stub.js');
export const SEED = JSON.parse(read('./fixtures/seed.json'));

function weatherFor(url) {
  const u = new URL(url);
  const start = new Date(u.searchParams.get('start_date') + 'T00:00:00Z');
  const end = new Date(u.searchParams.get('end_date') + 'T00:00:00Z');
  const codes = [0, 2, 61, 3, 80, 1, 95];
  const d = { time: [], temperature_2m_max: [], temperature_2m_min: [], weathercode: [], precipitation_sum: [] };
  for (let t = start, i = 0; t <= end; t = new Date(t.getTime() + 864e5), i++) {
    d.time.push(t.toISOString().slice(0, 10));
    d.temperature_2m_max.push(24 + (i % 4));
    d.temperature_2m_min.push(17 + (i % 3));
    d.weathercode.push(codes[i % codes.length]);
    d.precipitation_sum.push(codes[i % codes.length] >= 61 ? 4.2 : 0);
  }
  return { daily: d };
}

export const test = base.extend({
  seed: [SEED, { option: true }],
  errors: async ({}, use) => { await use([]); },
  page: async ({ page, seed, errors }, use) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
    });
    await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
    await page.route(/^https?:\/\/(?!localhost)/, (route) => {
      const url = route.request().url();
      const js = (body) => route.fulfill({ contentType: 'text/javascript', body });
      if (url.includes('firebase-app-compat')) return js(FIREBASE_STUB);
      if (url.includes('firebase-database-compat')) return js('');
      if (url.includes('maps.googleapis.com')) return js(MAPS_STUB);
      if (url.includes('html2canvas')) return js('window.html2canvas=function(){return Promise.resolve(document.createElement("canvas"))}');
      if (url.includes('tabler-icons')) return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.includes('api.open-meteo.com')) return route.fulfill({ json: weatherFor(url) });
      if (url.includes('currency-api')) return route.fulfill({ json: { date: '2026-10-01', usd: { usd: 1, twd: 32, jpy: 150, eur: 0.92, ntd: 32 } } });
      return route.abort();
    });
    await use(page);
  },
});
export { expect };

/** Open the app and enter group TEST01 as `uid` directly (bypasses login UI). */
export async function login(page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__seededCreds')) {
      localStorage.setItem('tg_creds', JSON.stringify({ name: 'Albert', pin: '1234' }));
      sessionStorage.setItem('__seededCreds', '1');
    }
  });
}
export async function enterTrip(page, { path = '/', uid = 'u1', name = 'Albert', isOrg = true } = {}) {
  await login(page);
  await page.goto(path);
  await page.waitForFunction(() => window._mapsReady && window.FB);
  await expect(page.locator('#S-login')).not.toHaveClass(/show/);   // auto-login via saved PIN
  await page.evaluate(([uid, name, isOrg]) => startApp('TEST01', uid, name, '測試團・大阪', isOrg), [uid, name, isOrg]);
  await expect(page.locator('#S-app')).toHaveClass(/show/);
}
export const writes = (page) => page.evaluate(() => window.__fbStub.writes);

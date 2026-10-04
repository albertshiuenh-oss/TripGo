import { test, expect, enterTrip, login, writes, SEED } from './harness.mjs';

test.afterEach(async ({ errors }, info) => {
  // Any uncaught JS error fails the test, whatever it was checking.
  if (info.status === 'passed') expect(errors, 'JS errors during test').toEqual([]);
});

test.describe('啟動', () => {
  test('首頁載入後不應出現「網路連線較慢」警告', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await expect(page.locator('#S-join')).not.toHaveClass(/hide/);
    await page.waitForFunction(() => window._mapsReady && window.FB);
    await page.waitForTimeout(8600);
    await expect(page.locator('#js-err')).not.toContainText('網路連線較慢');
  });

  test('已加入行程的使用者重新開啟會自動進入行程', async ({ page }) => {
    await login(page);
    await page.addInitScript(() => {
      localStorage.setItem('tg_code', 'TEST01'); localStorage.setItem('tg_uid', 'u1'); localStorage.setItem('tg_name', 'Albert');
    });
    await page.goto('/');
    await expect(page.locator('#S-app')).toHaveClass(/show/, { timeout: 5000 });
    await page.waitForTimeout(2500);                      // let the PIN auto-login finish too
    await expect(page.locator('#S-join')).toBeHidden();   // join screen must not cover the trip
    await page.locator('.tab[data-pane="locations"]').click();
    await expect(page.locator('#pane-locations')).toHaveClass(/\bon\b/);
  });
});

test('花費名稱與付款人含 HTML 時只當文字顯示', async ({ page }) => {
  const seed = structuredClone(SEED);
  seed.tripgo.groups.TEST01.expenses['-ex'] = { name: '<img id="xss-exp" src=x>', amt: 100, payer: '<img id="xss-payer" src=x>', split: 4, per: 25, time: '10/2 12:00', uid: 'u1', currency: 'NTD' };
  await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
  await enterTrip(page);
  await page.locator('.tab[data-pane="expense"]').click();
  await expect(page.locator('#pane-expense .exp-nm', { hasText: 'xss-exp' })).toHaveCount(1);
  expect(await page.locator('#xss-exp, #xss-payer').count()).toBe(0);
});

test.describe('分頁', () => {
  test('每個分頁都能切換，且無 JS 錯誤', async ({ page }) => {
    await enterTrip(page);
    for (const pane of ['itinerary', 'restaurant', 'expense', 'locations', 'weather', 'itinerary']) {
      await page.locator(`.tab[data-pane="${pane}"]`).click();
      await expect(page.locator(`#pane-${pane}`)).toHaveClass(/\bon\b/);
    }
  });

  test('花費／成員／天氣頁完全隱藏地圖，行程頁顯示地圖', async ({ page }) => {
    await enterTrip(page);
    for (const pane of ['expense', 'locations', 'weather']) {
      await page.locator(`.tab[data-pane="${pane}"]`).click();
      await expect(page.locator('#map-wrap')).toBeHidden();
    }
    await page.locator('.tab[data-pane="itinerary"]').click();
    await expect(page.locator('#map-wrap')).toBeVisible();
  });

  test('天氣頁依每天出發地顯示卡片，日期格式 10/2（五）', async ({ page }) => {
    await enterTrip(page);
    await page.locator('.tab[data-pane="weather"]').click();
    const cards = page.locator('.wx-day-card');
    await expect(cards).toHaveCount(3, { timeout: 8000 });
    await expect(cards.first().locator('.wx-date')).toHaveText(/^\d{1,2}\/\d{1,2}（[日一二三四五六]）$/);
    await expect(cards.first().locator('.wx-loc-bar')).toContainText('KIX 關西國際機場');
    // fixed grid: icon column lines up across cards
    const xs = await cards.locator('.wx-icon').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
  });
});

test.describe('成員', () => {
  test('成員頁：每人一列、自己的列有高亮、組織者有標籤', async ({ page }) => {
    await enterTrip(page);
    await page.locator('.tab[data-pane="locations"]').click();
    const rows = page.locator('#pane-locations .mem-clist-row');
    await expect(rows).toHaveCount(4);                      // Cathy has 2 devices → 1 row
    await expect(page.locator('#pane-locations .mem-clist-row.is-self')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Albert' }).locator('.mem-tag-org')).toBeVisible();
    await expect(rows.filter({ hasText: 'Cathy' }).locator('.mem-tag-multi')).toHaveText('2台');
  });

  test('成員大頭貼有底色（白字才看得見）', async ({ page }) => {
    await enterTrip(page);
    await page.locator('.tab[data-pane="locations"]').click();
    const bgs = await page.locator('#pane-locations .mem-av').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(bgs.length).toBeGreaterThan(0);
    for (const bg of bgs) expect(bg, 'avatar background').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test('「成員管理」視窗也會列出成員', async ({ page }) => {
    await enterTrip(page);
    await page.locator('.tab[data-pane="locations"]').click();
    await page.locator('#btn-members').click();
    await expect(page.locator('#btn-members-close')).toBeVisible();
    const modalList = page.locator('#btn-members-close').locator('xpath=ancestor::*[.//*[@id="new-mem-name"]][1]').locator('#mem-list, #mem-list-modal');
    await expect(modalList.locator('.mem-clist-row')).toHaveCount(4);
  });

  test('成員名字含 HTML 時只當文字顯示，不會被當成標籤執行', async ({ page }) => {
    const seed = structuredClone(SEED);
    seed.tripgo.groups.TEST01.members.ux = { id: 'ux', name: '<img id="xss-probe" src=x>', role: 'member', joinedAt: 9 };
    await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
    await enterTrip(page);
    await page.locator('.tab[data-pane="locations"]').click();
    await expect(page.locator('#pane-locations .mem-clist-row', { hasText: 'xss-probe' })).toHaveCount(1);
    await page.locator('#btn-members').click();
    await page.locator('#btn-members-close').waitFor();
    expect(await page.locator('#xss-probe').count()).toBe(0);
  });

  test('設主辦需先確認；取消時不寫入任何資料', async ({ page }) => {
    await enterTrip(page);
    await page.locator('.tab[data-pane="locations"]').click();
    const before = (await writes(page)).length;
    await page.locator('#pane-locations .mem-clist-row', { hasText: 'Anna' }).locator('[data-action="setorg"]').click();
    await expect(page.locator('#confirm-dialog')).toHaveClass(/show/);
    await expect(page.locator('#cd-msg')).toContainText('Anna');
    await page.locator('#cd-no').click();
    expect((await writes(page)).length).toBe(before);
  });

  test('同一人用兩台裝置時，組織者標籤不會消失', async ({ page }) => {
    // Albert is organizer on device u1; this device is u1b (same name, role member).
    const seed = structuredClone(SEED);
    seed.tripgo.groups.TEST01.members.u1b = { id: 'u1b', name: 'Albert', role: 'member', joinedAt: 9 };
    await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
    await enterTrip(page, { uid: 'u1b', isOrg: false });
    await page.locator('.tab[data-pane="locations"]').click();
    await expect(page.locator('#pane-locations .mem-clist-row', { hasText: 'Albert' }).locator('.mem-tag-org')).toBeVisible();
  });
});

test.describe('預覽版', () => {
  test('預覽版的寫入只會進 tripgo-preview/，正式資料完全不動', async ({ page }) => {
    await enterTrip(page, { path: '/preview/' });
    await expect(page.locator('#tg-preview-badge')).toBeVisible();
    // cloned trip shows the live data
    await page.locator('.tab[data-pane="locations"]').click();
    await expect(page.locator('#pane-locations .mem-clist-row')).toHaveCount(4);
    // write something
    await page.evaluate(() => { S.myUid = 'u1'; S.myName = 'Albert'; });
    await page.evaluate(() => window.FB.push('tripgo/groups/TEST01/chat', { uid: 'u1', name: 'Albert', text: 'preview hi', sticker: false, time: '1/1 00:00' }));
    await page.waitForTimeout(100);
    const w = await writes(page);
    expect(w.length).toBeGreaterThan(0);
    expect(w.filter((x) => !x.path.startsWith('tripgo-preview/'))).toEqual([]);
    const db = await page.evaluate(() => window.__fbStub.dump());
    expect(Object.keys(db.tripgo.groups.TEST01.chat)).toHaveLength(1);   // live untouched
    expect(Object.keys(db['tripgo-preview'].groups.TEST01.chat)).toHaveLength(2);
  });

  test('預覽版的 localStorage 與正式版分開', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('tg_last_name', 'LiveName'));
    await page.goto('/preview/');
    await page.evaluate(() => localStorage.setItem('tg_last_name', 'PreviewName'));
    await page.goto('/');
    expect(await page.evaluate(() => localStorage.getItem('tg_last_name'))).toBe('LiveName');
  });
});

test('未捕捉的錯誤會回報到 tripgo/errors', async ({ page, errors }) => {
  await enterTrip(page);
  await page.evaluate(() => setTimeout(() => { throw new Error('boom-test'); }, 0));
  await page.waitForTimeout(200);
  const db = await page.evaluate(() => window.__fbStub.dump());
  const reported = Object.values(db.tripgo.errors || {});
  expect(reported.map((e) => e.msg).join()).toContain('boom-test');
  expect(reported[0].ver).toBe(await page.evaluate(() => window.TG_VERSION));
  errors.length = 0; // this error was intentional
});

test('首頁搜尋旅程時，輸入的名字含 HTML 只當文字顯示', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.evaluate(() => renderTripsPreview('<img id="xss-search" src=x>', true));
  await expect(page.locator('#jtp-list')).toContainText('xss-search');
  expect(await page.locator('#xss-search').count()).toBe(0);
});

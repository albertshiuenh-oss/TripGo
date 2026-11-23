import { test, expect, enterTrip, login, writes, SEED } from './harness.mjs';
import { readFileSync } from 'node:fs';


// Distance (px) between the vertical centre of `sel` and the centre of the scroll box `box`
const centreOffset = (page, box, sel) => page.evaluate(([box, sel]) => {
  const b = document.querySelector(box).getBoundingClientRect();
  const e = document.querySelector(sel).getBoundingClientRect();
  return Math.abs((e.top + e.bottom) / 2 - (b.top + b.bottom) / 2);
}, [box, sel]);

// Trip Oct 2–4 (seed) + one stop per day Oct 5–20; every added stop is a restaurant
const longTrip = () => {
  const seed = structuredClone(SEED);
  const stops = seed.tripgo.groups.TEST01.stops;
  for (let d = 5; d <= 20; d++) stops['-b' + d] = { name: 'Dinner ' + d, day: 'Oct ' + d, arrive: '18:00', depart: '19:30', lat: 34.7, lng: 135.5, category: '餐廳', createdAt: 100 + d };
  return seed;
};

test.afterEach(async ({ errors }, info) => {
  // Any uncaught JS error fails the test, whatever it was checking.
  if (info.status === 'passed') expect(errors, 'JS errors during test').toEqual([]);
});

test.describe('啟動', () => {
  test('首頁載入後不應出現「網路連線較慢」警告', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await expect(page.locator('#S-join')).not.toHaveClass(/hide/);
    await page.waitForFunction(() => window.FB);
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

test.describe('天氣：今天', () => {
  test('今天的卡片有「今天」標示、過去的日期變淡；晴天的淡黃色不是今天標示', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T12:00:00+08:00'));   // trip is Oct 2–4
    await enterTrip(page);
    await page.locator('.tab[data-pane="weather"]').click();
    await expect(page.locator('.wx-day-card')).toHaveCount(3, { timeout: 8000 });
    const today = page.locator('.wx-day-card.wx-today');
    await expect(today).toHaveCount(1);
    await expect(today.locator('.wx-date')).toContainText('10/3');
    await expect(today.locator('.wx-today-badge')).toHaveText('今天');
    await expect(page.locator('.wx-day-card.wx-past')).toHaveCount(1);
    await expect(page.locator('.wx-day-card.wx-past .wx-date')).toContainText('10/2');
    await expect(page.locator('.wx-today-badge')).toHaveCount(1);
  });

  test('今天往後的日期不變淡；行程結束後全部變淡、沒有「今天」', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00+08:00'));
    await enterTrip(page);
    await page.locator('.tab[data-pane="weather"]').click();
    await expect(page.locator('.wx-day-card')).toHaveCount(3, { timeout: 8000 });
    await expect(page.locator('.wx-day-card.wx-past')).toHaveCount(3);
    await expect(page.locator('.wx-today-badge')).toHaveCount(0);
  });

  test('今天在清單中間時，自動捲到畫面中間', async ({ page }) => {
    const seed = structuredClone(SEED);
    const stops = seed.tripgo.groups.TEST01.stops;
    // enough cards after today (Oct 10) that it can be scrolled to the top
    for (let d = 5; d <= 20; d++) stops['-b' + d] = { name: 'Day ' + d, day: 'Oct ' + d, arrive: '09:00', depart: '10:00', lat: 34.7, lng: 135.5, category: 'sight', createdAt: 100 + d };
    await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
    await page.clock.setFixedTime(new Date('2026-10-10T12:00:00+08:00'));
    await enterTrip(page);
    await page.locator('.tab[data-pane="weather"]').click();
    await expect(page.locator('.wx-day-card.wx-today')).toHaveCount(1, { timeout: 8000 });
    await expect.poll(() => centreOffset(page, '#wx-scroll', '.wx-day-card.wx-today')).toBeLessThan(80);
  });
});

test.describe('行程／餐廳：今天', () => {
  test('行程頁：今天的日期標題有「今天」標示，開啟時自動置中', async ({ page }) => {
    await page.addInitScript((s) => { window.__TG_SEED = s; }, longTrip());
    await page.clock.setFixedTime(new Date('2026-10-10T12:00:00+08:00'));
    await enterTrip(page);
    const hdr = page.locator('.day-hdr.day-today');
    await expect(hdr).toHaveCount(1);
    await expect(hdr).toContainText('Oct 10');
    await expect(hdr.locator('.day-badge')).toHaveText('今天');
    // today's block (header + its stop) is in the middle of the pane
    await expect.poll(() => page.evaluate(() => {
      const box = document.getElementById('pane-itinerary').getBoundingClientRect();
      const h = document.querySelector('.day-hdr.day-today').getBoundingClientRect();
      const last = document.querySelector('.day-hdr.day-today').nextElementSibling.getBoundingClientRect();
      return Math.abs((h.top + last.bottom) / 2 - (box.top + box.bottom) / 2);
    })).toBeLessThan(80);
  });

  test('行程頁：行程還沒開始時不標示、也不捲動', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-20T12:00:00+08:00'));
    await enterTrip(page);
    await page.waitForTimeout(700);
    await expect(page.locator('.day-hdr.day-today')).toHaveCount(0);
    expect(await page.locator('#pane-itinerary').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('行程頁：今天沒有行程時，置中到下一個有行程的日子', async ({ page }) => {
    const seed = longTrip();
    delete seed.tripgo.groups.TEST01.stops['-b10'];                        // nothing planned on Oct 10
    await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
    await page.clock.setFixedTime(new Date('2026-10-10T12:00:00+08:00'));
    await enterTrip(page);
    await expect(page.locator('.day-hdr.day-today')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const box = document.getElementById('pane-itinerary').getBoundingClientRect();
      const h = [...document.querySelectorAll('.day-hdr')].find((x) => x.textContent.includes('Oct 11'));
      const a = h.getBoundingClientRect(), z = h.nextElementSibling.getBoundingClientRect();
      return Math.abs((a.top + z.bottom) / 2 - (box.top + box.bottom) / 2);
    })).toBeLessThan(80);
  });

  test('「下一站」那一列有底色，且 id 沒被塞進 class 名稱', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T09:00:00+08:00'));  // next stop = 大阪城 09:30
    await enterTrip(page);
    await expect(page.locator('.stop-row.stop-next-row')).toHaveCount(1);
    await expect(page.locator('.stop-row.stop-next-row .stop-name')).toContainText('大阪城');
    expect(await page.locator('[id^="sr-"]').evaluateAll((els) => els.filter((e) => /\s/.test(e.id)).length)).toBe(0);
  });

  test('食住規畫頁：今天的那幾行有標示「今天」，切換進來時自動置中', async ({ page }) => {
    await page.addInitScript((s) => { window.__TG_SEED = s; }, longTrip());
    await page.clock.setFixedTime(new Date('2026-10-10T12:00:00+08:00'));
    await enterTrip(page);
    await page.locator('.tab[data-pane="restaurant"]').click();
    const rows = page.locator('.rest-row.day-today');
    await expect(rows.first()).toBeVisible();
    expect(await rows.evaluateAll((els) => els.every((e) => e.dataset.date === '2026-10-10'))).toBe(true);
    await expect(rows.first().locator('.rr-date')).toHaveText('今天');
    await expect.poll(() => page.evaluate(() => {
      const box = document.getElementById('restaurant-list').getBoundingClientRect();
      const t = document.querySelectorAll('.rest-row.day-today');
      const a = t[0].getBoundingClientRect(), z = t[t.length - 1].getBoundingClientRect();
      return Math.abs((a.top + z.bottom) / 2 - (box.top + box.bottom) / 2);
    })).toBeLessThan(80);
  });

  test('App 放在背景跨過午夜，回到前景時「今天」會更新', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T12:00:00+08:00'));
    await enterTrip(page);
    await expect(page.locator('.day-hdr.day-today')).toContainText('Oct 3');
    await page.clock.setFixedTime(new Date('2026-10-04T08:00:00+08:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.day-hdr.day-today')).toContainText('Oct 4');
    await expect(page.locator('.day-hdr.day-today')).toHaveCount(1);
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
    // 帳號雲端同步（tripgo/accounts/…）是背景寫入，不算在「設主辦」的資料變動裡
    const groupWrites = async () => (await writes(page)).filter((w) => !String(w.path).includes('tripgo/accounts/')).length;
    const before = await groupWrites();
    await page.locator('#pane-locations .mem-clist-row', { hasText: 'Anna' }).locator('[data-action="setorg"]').click();
    await expect(page.locator('#confirm-dialog')).toHaveClass(/show/);
    await expect(page.locator('#cd-msg')).toContainText('Anna');
    await page.locator('#cd-no').click();
    expect(await groupWrites()).toBe(before);
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

test('景點的活動與備註含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    renderActs({ activities: [{ label: '<img id="xss-act" src=x>', done: false }] });
    renderNotes({ notes: ['<img id="xss-note" src=x>'] });
  });
  await expect(page.locator('#act-list')).toContainText('xss-act');
  await expect(page.locator('#note-list')).toContainText('xss-note');
  expect(await page.locator('#xss-act, #xss-note').count()).toBe(0);
});

test('管理員垃圾桶：旅程名稱含 HTML 時只當文字顯示', async ({ page }) => {
  const seed = structuredClone(SEED);
  seed.tripgo.trash = { OLD01: { tripName: '<img id="xss-trash" src=x>', _trashedAt: Date.now() } };
  await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
  await enterTrip(page);
  await page.evaluate(() => loadTrashBin());
  await expect(page.locator('#adm-trash-list')).toContainText('xss-trash');
  expect(await page.locator('#xss-trash').count()).toBe(0);
});

test('管理員旅程總覽：旅程名稱與成員名稱含 HTML 時只當文字顯示', async ({ page }) => {
  const seed = structuredClone(SEED);
  seed.tripgo.groups.EVIL01 = { tripName: '<img id="xss-trip" src=x>', members: { m1: { name: '<img id="xss-mem" src=x>' } } };
  seed.tripgo.groups.EVIL02 = { tripName: '"><img id="xss-attr" src=x>', members: {} };
  await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
  await enterTrip(page);
  await page.evaluate(() => loadAllTrips());
  await expect(page.locator('#adm-trip-list')).toContainText('xss-trip');
  await expect(page.locator('#adm-trip-list')).toContainText('xss-mem');
  expect(await page.locator('#xss-trip, #xss-mem, #xss-attr').count()).toBe(0);
});

test('管理員授權碼列表：備註與使用者名稱含 HTML 時只當文字顯示', async ({ page }) => {
  const seed = structuredClone(SEED);
  seed.tripgo.create_tokens = { 'BUILD-AAAA': { note: '<img id="xss-note2" src=x>', usedAt: 1, usedBy: '<img id="xss-by" src=x>' } };
  await page.addInitScript((s) => { window.__TG_SEED = s; }, seed);
  await enterTrip(page);
  await page.evaluate(() => loadTokenList());
  await expect(page.locator('#adm-token-list')).toContainText('xss-by');
  await expect(page.locator('#adm-token-list')).toContainText('xss-note2');
  expect(await page.locator('#xss-by, #xss-note2').count()).toBe(0);
});

test('行程列表的景點名稱含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    S.stops = [{ name: '<img id="xss-stop" src=x>', category: '景點', arrive: '09:00', depart: '10:00' }];
    renderStops();
    showSimplePc({ name: 'x', note: '<img id="xss-pcnote" src=x>' });
  });
  await expect(page.locator('#pc-info')).toContainText('xss-pcnote');
  expect(await page.locator('#xss-stop, #xss-pcnote').count()).toBe(0);
});

test('景點編輯面板：活動與備註含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    const s = { activities: [{ label: '<img id="xss-eact" src=x>', done: false }], notes: ['<img id="xss-enote" src=x>'] };
    const box = document.createElement('div');
    box.id = 'xss-box';
    box.innerHTML = renderActsEditable(s) + renderNotesEditable(s);
    document.body.appendChild(box);
  });
  await expect(page.locator('#xss-box')).toContainText('xss-eact');
  await expect(page.locator('#xss-box')).toContainText('xss-enote');
  expect(await page.locator('#xss-eact, #xss-enote').count()).toBe(0);
});

test('「刪除景點？」確認視窗：景點名稱含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    S.stops = [{ name: '<img id="xss-del" src=x>', category: '景點', arrive: '09:00', depart: '10:00', _key: 'k1' }];
    renderStops();
    const b = document.createElement('button');
    b.className = 'exp-del-btn';
    b.dataset.i = '0';
    document.getElementById('stop-list').appendChild(b);
    b.click();
  });
  await expect(page.locator('#cd-msg')).toContainText('xss-del');
  expect(await page.locator('#xss-del').count()).toBe(0);
});

test('旅程切換面板：旅程名稱與使用者名稱含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    saveStoredTrips([
      { code: S.groupCode, tripName: '<img id="xss-cur" src=x>', name: '<img id="xss-curn" src=x>', isOrg: true, uid: 'u1' },
      { code: 'ZZZ99', tripName: '<img id="xss-oth" src=x>', name: '<img id="xss-othn" src=x>', isOrg: false, uid: 'u9' }
    ]);
    openTripSwitcher();
  });
  await expect(page.locator('#tsw-current')).toContainText('xss-cur');
  await expect(page.locator('#trip-switcher')).toContainText('xss-oth');
  expect(await page.locator('#xss-cur, #xss-curn, #xss-oth, #xss-othn').count()).toBe(0);
});

test('聊天室：訊息內容與暱稱含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    appendMsg('u2', '<img id="xss-chat-nm" src=x>', '<img id="xss-chat-tx" src=x>', false, '1/1 00:00', 'k-xss');
  });
  await expect(page.locator('#msg-list')).toContainText('xss-chat-tx');
  await expect(page.locator('#msg-list')).toContainText('xss-chat-nm');
  expect(await page.locator('#xss-chat-nm, #xss-chat-tx').count()).toBe(0);
});

test('行程列表與餐廳列表的日期標題含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    S.stops = [{ name: 'a', category: '餐廳', day: '<img id="xss-day" src=x>', note: '<img id="xss-snote" src=x>', arrive: '09:00', depart: '10:00' }];
    renderStops();
    renderRestaurant();
  });
  await expect(page.locator('#stop-list, .day-hdr').first()).toContainText('xss-day');
  expect(await page.locator('#xss-day, #xss-snote').count()).toBe(0);
  await expect(page.locator('.stop-time .stop-time-stay, .stop-time span').first()).toBeVisible();
});

test('費用卡片：分攤成員名稱與幣別含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  await page.evaluate(() => {
    S.expenses = { kx: { name: 'x', amt: 100, payer: 'Albert', currency: '<img id="xss-cur2" src=x>', splitMembers: ['<img id="xss-split" src=x>', 'Anna'] } };
    renderExpenses();
  });
  await expect(page.locator('#exp-list')).toContainText('xss-split');
  expect(await page.locator('#xss-split, #xss-cur2').count()).toBe(0);
});

test('首頁旅程列表：一般團員也能把旅程標為「完成」，但不能刪除', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('tg_synced_p_albert'));   // 等登入後的雲端同步結束，避免它在測試中途重畫清單
  await page.evaluate(() => {
    localStorage.setItem('tg_trips', JSON.stringify([{ code: 'TEST01', uid: 'u2', name: 'Anna', tripName: '大阪', isOrg: false }]));
    document.getElementById('js-home-name').value = 'Anna';   // 輸入框也要是 Anna，否則 Albert 的雲端搜尋結果晚到時會把清單換掉
    renderTripsPreview('Anna', true);
  });
  await expect(page.locator('#jtp-list .jtp-complete-btn')).toHaveCount(1);
  expect(await page.locator('#jtp-list .jtp-del').count()).toBe(0);
  await page.locator('#jtp-list .jtp-complete-btn').click();
  await page.locator('#confirm-dialog button', { hasText: '標為已完成' }).click();
  await expect(page.locator('#jtp-done-section')).toContainText('大阪');
});

test('行前簡報圖片：旅程名稱、景點、成員、幣別含 HTML 時只當文字顯示', async ({ page }) => {
  await enterTrip(page);
  const r = await page.evaluate(() => {
    S.tripName = '<img id="xss-bt" src=x>';
    S.stops = [{ name: '<img id="xss-bs" src=x>', day: 'Oct 2', arrive: '09:00', depart: '10:00' }];
    S.members = [{ id: 'u9', name: '<img id="xss-bm" src=x>', role: 'member' }];
    S.expenses = { k: { name: 'x', amt: 100, payer: 'a', currency: '<img id="xss-bc" src=x>' } };
    const d = document.createElement('div'); d.innerHTML = generateBriefingHTML();
    return { n: d.querySelectorAll('#xss-bt, #xss-bs, #xss-bm, #xss-bc').length, t: d.textContent };
  });
  expect(r.n).toBe(0);
  for (const k of ['xss-bt', 'xss-bs', 'xss-bm', 'xss-bc']) expect(r.t).toContain(k);
});

test('匯出 KML：景點備註、活動、預算與成員名稱含 HTML 時會跳脫', async ({ page }) => {
  await enterTrip(page);
  const kml = await page.evaluate(async () => {
    const snap = (o) => ({ exists: () => true, val: () => o });
    window.FB.get = (path) => Promise.resolve(snap(
      path.endsWith('/stops') ? { a: { name: 's', day: 'Oct 2', note: '<img id="xss-kn" src=x>', activities: [{ text: '<img id="xss-ka" src=x>' }], budget: '<img id="xss-kb" src=x>' } }
        : path.endsWith('/members') ? { m: { name: '<img id="xss-km" src=x>', role: 'member' } } : {}));
    let blob; URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
    window.open = () => null; HTMLAnchorElement.prototype.click = () => {};
    exportTripKML('TEST01', 't');
    for (let i = 0; i < 50 && !blob; i++) await new Promise(r => setTimeout(r, 50));
    return blob.text();
  });
  expect(kml).not.toMatch(/<img/);
  for (const k of ['xss-kn', 'xss-ka', 'xss-kb', 'xss-km']) expect(kml).toContain(k);
});

test.describe('載入計時器', () => {
  test('等待超過 0.6 秒會出現沙漏與已等待秒數，結束後消失', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.FB);
    await page.evaluate(() => loadBegin('t', '測試載入'));
    const pill = page.locator('#ld-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('⏳');
    await expect(pill).toContainText(/測試載入… \d+ 秒/);
    await page.evaluate(() => loadEnd('t'));
    await expect(pill).toBeHidden();
  });

  test('很快就完成的載入不會閃出計時器', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.FB);
    await page.waitForTimeout(700);
    await page.evaluate(() => { loadBegin('q', '很快'); loadEnd('q'); });
    await page.waitForTimeout(800);
    await expect(page.locator('#ld-pill')).toBeHidden();
  });

  test('等超過 10 秒會提示網路較慢', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await page.evaluate(() => loadBegin('slow', '很慢的載入'));
    await page.clock.runFor(11000);
    await expect(page.locator('#ld-pill')).toContainText('網路較慢');
  });

  test('Google 地圖連不上：進入旅程後計時器會結束並提示，App 其他功能照常', async ({ page }) => {
    await page.route(/maps\.googleapis\.com/, (r) => r.abort());
    await login(page);
    await page.addInitScript(() => {
      localStorage.setItem('tg_code', 'TEST01'); localStorage.setItem('tg_uid', 'u1'); localStorage.setItem('tg_name', 'Albert');
    });
    await page.goto('/');
    await expect(page.locator('#S-app')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('#toast, .toast').filter({ hasText: '地圖暫時無法載入' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#ld-pill')).toBeHidden();
    await expect(page.locator('.stop-row').first()).toBeVisible();
  });
});

test.describe('載入效能', () => {
  test('首頁（還沒進入旅程）不載入 Google 地圖；進入旅程後才載入', async ({ page }) => {
    const mapReqs = [];
    page.on('request', (r) => { if (r.url().includes('maps.googleapis.com')) mapReqs.push(r.url()); });
    await login(page);
    await page.goto('/');
    await expect(page.locator('#S-join')).not.toHaveClass(/hide/);
    await page.waitForTimeout(600);
    expect(mapReqs).toEqual([]);
    await page.evaluate(() => startApp('TEST01', 'u1', 'Albert', '測試團・大阪', true));
    await page.waitForFunction(() => window._mapsReady);
    expect(mapReqs.length).toBe(1);
  });

  test('地圖一直載入不到（逾時）也不會擋住自動回到上次旅程', async ({ page }) => {
    await page.route(/maps\.googleapis\.com/, () => { /* 永遠不回應 */ });
    await login(page);
    await page.addInitScript(() => {
      localStorage.setItem('tg_code', 'TEST01'); localStorage.setItem('tg_uid', 'u1'); localStorage.setItem('tg_name', 'Albert');
    });
    await page.goto('/');
    await expect(page.locator('#S-app')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('.stop-row').first()).toBeVisible();
    expect(await page.evaluate(() => window._mapsReady)).toBe(false);
  });

  test('地圖還沒載入時按導航不會出錯，只提示稍後再試', async ({ page }) => {
    await page.route(/maps\.googleapis\.com/, () => { /* 永遠不回應 */ });
    await login(page);
    await page.goto('/');
    await page.waitForFunction(() => window.FB);
    await page.evaluate(() => { navTo({ lat: 34.7, lng: 135.5 }, 'x'); });
    await expect(page.locator('#toast, .toast').filter({ hasText: '地圖還在載入' }).first()).toBeVisible();
  });

  test('雲端搜尋旅程只讀旅程名稱與成員，不下載景點、聊天、花費', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForFunction(() => window.FB);
    const out = await page.evaluate(async () => {
      window.__fbStub.reads.length = 0;
      const g = await FB.getGroupSummaries();
      return { keys: Object.keys(g), t: g.TEST01.tripName, mems: Object.keys(g.TEST01.members || {}).length, hasStops: 'stops' in g.TEST01, reads: window.__fbStub.reads.slice() };
    });
    expect(out.keys).toContain('TEST01');
    expect(out.t).toBe('測試團・大阪');
    expect(out.mems).toBeGreaterThan(0);
    expect(out.hasStops).toBe(false);
    expect(out.reads.filter((p) => /\/(stops|chat|expenses)/.test(p) || p === 'tripgo/groups')).toEqual([]);
  });

  test('新裝置登入後，雲端搜尋找得到自己的旅程；shallow 查詢失敗時退回完整查詢也找得到', async ({ page }) => {
    for (const failShallow of [false, true]) {
      if (failShallow) await page.route(/firebaseio\.com.*shallow=true/, (r) => r.abort());
      await page.goto('/');
      await page.evaluate(() => { try { localStorage.removeItem('tg_trips'); localStorage.removeItem('tg_uid'); } catch (e) {} });
      await login(page);
      await page.goto('/');
      await expect(page.locator('#jtp-list')).toContainText('測試團・大阪', { timeout: 6000 });
    }
  });

  test('登入名字輸入：連續打字只在停下來後查一次帳號', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.FB);
    await expect(page.locator('#S-login')).toHaveClass(/show/);
    await page.evaluate(() => { window.__fbStub.reads.length = 0; });
    await page.locator('#login-name').pressSequentially('Albert', { delay: 10 });
    await expect(page.locator('#login-hint')).toContainText('找到帳號');
    const n = await page.evaluate(() => window.__fbStub.reads.filter((p) => p.startsWith('tripgo/accounts/')).length);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(3);   // 打 6 個字，舊做法會查 5 次；防抖後只會在停下來時查 1 次
  });
});

test.describe('帳號同步（手機與電腦共用旅程清單與完成狀態）', () => {
  const withCloud = (trips) => { const sd = structuredClone(SEED); sd.tripgo.accounts.p_albert.trips = trips; return sd; };
  const cloudOf = (page) => page.evaluate(() => (window.__fbStub.dump().tripgo.accounts.p_albert || {}).trips || null);

  test.describe('新裝置從雲端取得清單', () => {
    test.use({ seed: withCloud({
      OZ1: { tripName: 'Oz Escape', uid: 'u9', isOrg: true, completed: false, ts: 300 },
      TEST01: { tripName: '測試團・大阪', uid: 'u1', isOrg: true, completed: true, ts: 200 },
    }) });
    test('清單與「已完成」都跟雲端一致（雲端搜尋找不到的旅程也會出現）', async ({ page }) => {
      await login(page);
      await page.goto('/');
      await expect(page.locator('#jtp-list')).toContainText('Oz Escape', { timeout: 6000 });
      await expect(page.locator('#jtp-done-section')).toContainText('測試團・大阪');
      await expect(page.locator('#jtp-list')).not.toContainText('測試團・大阪');
    });
  });

  test.describe('雲端旅程名稱含 HTML', () => {
    test.use({ seed: withCloud({ X1: { tripName: '<img src=x onerror="window.__x=1">', uid: 'u1', isOrg: false, completed: false, ts: 1 } }) });
    test('旅程名稱只當文字顯示', async ({ page }) => {
      await login(page);
      await page.goto('/');
      await expect(page.locator('#jtp-list')).toContainText('<img', { timeout: 6000 });
      expect(await page.locator('#jtp-list img').count()).toBe(0);
      expect(await page.evaluate(() => window.__x)).toBeUndefined();
    });
  });

  test.describe('標記完成／恢復', () => {
    test.use({ seed: withCloud({ TEST01: { tripName: '測試團・大阪', uid: 'u1', isOrg: true, completed: false, ts: 200 } }) });
    test('標記完成與恢復都會寫進雲端帳號', async ({ page }) => {
      await login(page);
      await page.goto('/');
      await expect(page.locator('#jtp-list')).toContainText('測試團・大阪', { timeout: 6000 });
      await page.evaluate(() => markTripCompleted('TEST01', true));
      await expect.poll(async () => (await cloudOf(page)).TEST01.completed).toBe(true);
      await page.evaluate(() => markTripCompleted('TEST01', false));
      await expect.poll(async () => (await cloudOf(page)).TEST01.completed).toBe(false);
    });
  });

  test.describe('這台裝置還沒同步就進入旅程', () => {
    test.use({ seed: withCloud({ TEST01: { tripName: '測試團・大阪', uid: 'u1', isOrg: true, completed: true, ts: 200 } }) });
    test('進入旅程不會把別台標的「已完成」蓋掉', async ({ page }) => {
      await login(page);
      await page.goto('/');
      await page.waitForFunction(() => window.FB && window._currentUser !== undefined);
      await page.evaluate(() => { _acctKey = 'p_albert'; updateStoredTrip('TEST01', 'u1', 'Albert', '測試團・大阪', true); });
      await page.waitForTimeout(300);
      expect((await cloudOf(page)).TEST01.completed).toBe(true);
    });
  });

  test('這台裝置第一次同步：把本機舊清單（含已完成）上傳到雲端帳號', async ({ page }) => {
    await login(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('__trips')) {
        localStorage.setItem('tg_trips', JSON.stringify([{ code: 'TEST01', uid: 'u1', name: 'Albert', tripName: '測試團・大阪', isOrg: true, completed: true }]));
        sessionStorage.setItem('__trips', '1');
      }
    });
    await page.goto('/');
    await expect.poll(async () => ((await cloudOf(page)) || {}).TEST01 && (await cloudOf(page)).TEST01.completed, { timeout: 6000 }).toBe(true);
  });

  test.describe('離開旅程', () => {
    test.use({ seed: withCloud({ TEST01: { tripName: '測試團・大阪', uid: 'u1', isOrg: true, completed: false, ts: 200 } }) });
    test('離開旅程後，會從成員名單與雲端帳號清單一起移除，且不會被雲端搜尋加回來', async ({ page }) => {
      await login(page);
      await page.goto('/');
      await expect(page.locator('#jtp-list')).toContainText('測試團・大阪', { timeout: 6000 });
      // 離開 = 從成員名單移除自己（這裡把 Albert 的所有成員記錄都移除，模擬真的離開）
      await page.evaluate(() => { ['u1'].forEach((u) => FB.remove('tripgo/groups/TEST01/members/' + u)); });
      await page.evaluate(() => leaveTrip('TEST01', 'u1'));
      await page.locator('#cd-yes').click();
      await expect.poll(async () => ((await cloudOf(page)) || {}).TEST01).toBeUndefined();
      await page.waitForTimeout(1200);   // 等雲端搜尋跑完，確認不會被加回來
      expect(((await cloudOf(page)) || {}).TEST01).toBeUndefined();
    });
  });
});

test.describe('建立群組按鈕', () => {
  const admin = (page) => page.evaluate(() => [DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PW]);
  const seedWithToken = () => { const sd = structuredClone(SEED); sd.tripgo.create_tokens = { 'BUILD-T1': { note: 't', createdAt: 1, usedAt: null, usedBy: '' } }; return sd; };

  test('首頁一直顯示「建立群組」，緊接在「加入群組」下面', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await expect(page.locator('#btn-create')).toBeVisible();
    // 版面順序：「建立群組」緊接在「加入群組」之後（用 DOM 順序判斷，不受旅程清單載入時的位置移動影響）
    expect(await page.evaluate(() => document.getElementById('btn-join').nextElementSibling.id)).toBe('btn-create');
  });

  test('還沒驗證時點「建立群組」會先要求管理員登入，成功後直接進入建立畫面', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.locator('#btn-create').click();
    await expect(page.locator('#M-admin')).toHaveClass(/show/);
    await expect(page.locator('#adm-use-token')).toBeVisible();
    const [email, pw] = await admin(page);
    await page.locator('#adm-email').fill(email);
    await page.locator('#adm-pw').fill('wrong-password');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page.locator('#adm-err')).toContainText('錯誤');
    await expect(page.locator('#js-sub')).toBeHidden();
    await page.locator('#adm-pw').fill(pw);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page.locator('#js-sub-title')).toHaveText('建立群組');
    await expect(page.locator('#M-admin-panel')).not.toHaveClass(/show/);
    await expect(page.locator('#M-admin')).not.toHaveClass(/show/);
  });

  test('取消後，從齒輪進管理員設定仍是打開管理員面板（不會跳去建立）', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.locator('#btn-create').click();
    await page.locator('#M-admin .adm-cancel').click();
    await page.evaluate(() => openAdmin());
    await expect(page.locator('#adm-use-token')).toBeHidden();
    const [email, pw] = await admin(page);
    await page.locator('#adm-email').fill(email);
    await page.locator('#adm-pw').fill(pw);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page.locator('#M-admin-panel')).toHaveClass(/show/);
  });

  test.describe('授權碼', () => {
    test.use({ seed: seedWithToken() });
    test('用授權碼解鎖後可以建立群組（授權碼只能用一次）', async ({ page }) => {
      await login(page);
      await page.goto('/');
      await page.locator('#btn-create').click();
      await page.locator('#adm-use-token').click();
      await page.locator('#tok-code-inp').fill('BUILD-T1');
      await page.locator('#M-token-input').getByRole('button', { name: '驗證' }).click();
      await expect(page.locator('#js-sub-title')).toHaveText('建立群組');
      await page.locator('#inp-create-name').fill('Albert');
      await page.locator('#inp-trip-name').fill('授權碼測試團');
      await page.locator('#js-go-btn').click();
      await expect(page.locator('#S-app')).toHaveClass(/show/, { timeout: 8000 });
      const used = await page.evaluate(() => window.__fbStub.dump().tripgo.create_tokens['BUILD-T1'].usedAt);
      expect(used).toBeTruthy();
    });
  });
});

test.describe('飲食行程的判斷與分類', () => {
  const foodSeed = () => {
    const sd = structuredClone(SEED);
    const st = sd.tripgo.groups.TEST01.stops;
    const base = { day: 'Oct 2', arrive: '09:00', depart: '10:00', lat: 34.7, lng: 135.5 };
    st['-f1'] = { ...base, name: '宵夜 해성막창집', note: '烤牛腸', category: '' };               // 名稱含「宵夜」
    st['-f2'] = { ...base, name: '佛國寺', note: '11:30 午餐後開往通度寺', category: '景點' };    // 午餐後、景點
    st['-f3'] = { ...base, name: '白淺灘文化村', note: '海岸步道、海景咖啡', category: '景點' };  // 明確是景點
    st['-f4'] = { ...base, name: '某間小店', note: '', category: '餐廳' };                        // 明確是餐廳
    st['-f5'] = { ...base, name: '朝聖店', note: '晚餐 烤豬皮', category: '' };                    // 備註含「晚餐」
    st['-f6'] = { ...base, name: '飯店', note: '含早餐', category: '住宿' };                        // 住宿不算
    st['-f7'] = { ...base, name: '某公園', note: '午餐後散步', category: '' };                     // 沒分類，只有「午餐後」
    st['-f8'] = { ...base, name: '海邊攤販', note: '買點心', category: '' };                         // 沒分類，備註含「點心」
    st['-f9'] = { ...base, name: '夜市', note: '消夜 吃烤肉', category: '' };                         // 沒分類，備註含「消夜」
    st['-f10'] = { ...base, name: '早餐店', note: '', category: '' };                                // 沒分類，名稱含「早餐」
    return sd;
  };
  test.describe('判斷規則', () => {
    test.use({ seed: foodSeed() });
    test('名稱、備註與分類一起判斷；景點／住宿不被關鍵字誤判；「午餐後」不算', async ({ page }) => {
      await enterTrip(page);
      const names = await page.evaluate(() => S.stops.filter(isFood).map((s) => s.name).sort());
      expect(names).toEqual(['宵夜 해성막창집', '某間小店', '朝聖店', '海邊攤販', '夜市', '早餐店'].sort());
    });
  });

  test('既有景點的「編輯」表單有「分類」，且帶入目前的分類', async ({ page }) => {
    await enterTrip(page);
    await page.evaluate(() => { const i = S.stops.findIndex((s) => s.name === '道頓堀'); window.FB.set('tripgo/groups/TEST01/stops/-a02/category', '景點'); });
    await page.waitForFunction(() => S.stops.find((s) => s.name === '道頓堀').category === '景點');
    await page.evaluate(() => { const i = S.stops.findIndex((s) => s.name === '道頓堀'); tapStop(i); setTimeout(() => openInlineEdit(i), 50); });
    await expect(page.locator('#ief-category')).toHaveValue('景點');
  });

  test('編輯景點後儲存，原本的分類不會被清掉；改成「餐廳」後會出現在飲食行程', async ({ page }) => {
    await enterTrip(page);
    await page.evaluate(() => window.FB.set('tripgo/groups/TEST01/stops/-a02/category', '景點'));
    await page.waitForFunction(() => S.stops.find((s) => s.name === '道頓堀').category === '景點');
    const idx = () => page.evaluate(() => S.stops.findIndex((s) => s.name === '道頓堀'));
    // 只改備註、不動分類 → 分類保留
    await page.evaluate((i) => { tapStop(i); setTimeout(() => openInlineEdit(i), 50); }, await idx());
    await page.locator('#ief-note').fill('試吃章魚燒');
    await page.locator('.exp-ef-save').click();
    await page.waitForFunction(() => S.stops.find((s) => s.name === '道頓堀').note === '試吃章魚燒');
    expect(await page.evaluate(() => S.stops.find((s) => s.name === '道頓堀').category)).toBe('景點');
    // 改成餐廳 → 出現在飲食行程
    await page.evaluate((i) => { tapStop(i); setTimeout(() => openInlineEdit(i), 50); }, await idx());
    await page.locator('#ief-category').selectOption('餐廳');
    await page.locator('.exp-ef-save').click();
    await page.waitForFunction(() => S.stops.find((s) => s.name === '道頓堀').category === '餐廳');
    await page.locator('.tab[data-pane="restaurant"]').click();
    await expect(page.locator('#restaurant-list')).toContainText('道頓堀');
  });
});

test.describe('前段交通：計程車', () => {
  test('編輯表單有「計程車」，選了會存進去並顯示在行程；新增景點表單也有', async ({ page }) => {
    await enterTrip(page);
    const idx = await page.evaluate(() => S.stops.findIndex((s) => s.name === '道頓堀'));
    await page.evaluate((i) => { tapStop(i); setTimeout(() => openInlineEdit(i), 50); }, idx);
    await expect(page.locator('#ief-transit-mode option[value="taxi"]')).toHaveText(/計程車/);
    await page.locator('#ief-transit-mode').selectOption('taxi');
    await page.locator('#ief-transit-mins').fill('15');
    await page.locator('.exp-ef-save').click();
    await page.waitForFunction(() => { const s = S.stops.find((x) => x.name === '道頓堀'); return s.transit && s.transit.mode === 'taxi' && s.transit.minutes === 15; });
    await page.evaluate(() => openNewStopForm());
    await expect(page.locator('#ief-transit-mode option[value="taxi"]')).toHaveText(/計程車/);
  });
});

test('分類選單的「餐廳」圖示用表情符號版（帶 U+FE0F），與其他分類對齊', async ({ page }) => {
  await enterTrip(page);
  const idx = await page.evaluate(() => S.stops.findIndex((s) => s.name === '道頓堀'));
  await page.evaluate((i) => { tapStop(i); setTimeout(() => openInlineEdit(i), 50); }, idx);
  const label = await page.locator('#ief-category option[value="餐廳"]').textContent();
  expect(label).toContain('\u{1F37D}\uFE0F');
  await page.evaluate(() => openNewStopForm());
  expect(await page.locator('#ief-category option[value="餐廳"]').last().textContent()).toContain('\u{1F37D}\uFE0F');
});

test('首頁旅程卡片的按鈕顯示「未完成」，顏色比原本（#7cba7e）淡', async ({ page }) => {
  await login(page);
  await page.goto('/');
  const btn = page.locator('#jtp-list .jtp-complete-btn').first();
  await expect(btn).toHaveText('未完成', { timeout: 6000 });
  const c = await btn.evaluate((el) => getComputedStyle(el).color);   // rgb(r, g, b)
  const [r, g, b] = c.match(/\d+/g).map(Number);
  expect(r).toBeGreaterThan(0x7c);   // 比 #7cba7e 的紅色分量高 → 更淡
  expect(b).toBeGreaterThan(0x7e);
});

test.describe('天氣：超過 16 天的行程', () => {
  const openWx = async (page, iso) => {
    await page.clock.setFixedTime(new Date(iso));
    await enterTrip(page);
    await page.locator('.tab[data-pane="weather"]').click();
  };

  test('整趟都在預報範圍外：改顯示「去年同日」參考，並清楚標示不是預報', async ({ page }) => {
    const reqs = [];
    page.on('request', (r) => { if (r.url().includes('open-meteo.com')) reqs.push(r.url()); });
    await openWx(page, '2026-09-01T12:00:00+08:00');   // 行程 10/2–10/4，距今超過 16 天
    await expect(page.locator('.wx-day-card')).toHaveCount(3, { timeout: 8000 });
    await expect(page.locator('.wx-day-card .wx-refnote')).toHaveCount(3);
    await expect(page.locator('.wx-day-card').first()).toContainText('去年同日（參考，非預報）');
    await expect(page.locator('.wx-day-card').first()).toContainText('°C');
    await expect(page.locator('.wx-icon', { hasText: '❓' })).toHaveCount(0);
    await expect(page.locator('.wx-summary')).toContainText('含去年同日參考');
    const arch = reqs.filter((u) => u.includes('archive-api'));
    expect(arch.length).toBeGreaterThan(0);   // 每個出發地各一次
    for (const u of arch) expect(u).toMatch(/start_date=2025-10-0[2-4]&end_date=2025-10-0[2-4]|end_date=2025-10-0[2-4]&start_date=2025-10-0[2-4]/);
    expect(reqs.filter((u) => u.includes('/v1/forecast')).length).toBe(0);   // 不再送必定失敗的預報請求
  });

  test('一部分在預報範圍內：範圍內用預報，範圍外用去年同日', async ({ page }) => {
    await openWx(page, '2026-09-17T12:00:00+08:00');   // 預報到 10/2
    await expect(page.locator('.wx-day-card')).toHaveCount(3, { timeout: 8000 });
    await expect(page.locator('.wx-day-card .wx-refnote')).toHaveCount(2);
    await expect(page.locator('.wx-day-card').first().locator('.wx-refnote')).toHaveCount(0);
  });

  test('去年的資料也取不到時，顯示「預報尚未開放」而不是卡住', async ({ page }) => {
    await page.route(/archive-api\.open-meteo\.com/, (r) => r.abort());
    await openWx(page, '2026-09-01T12:00:00+08:00');
    await expect(page.locator('.wx-day-card')).toHaveCount(3, { timeout: 8000 });
    await expect(page.locator('.wx-day-card').first()).toContainText('預報尚未開放');
  });
});

test('首頁「未完成」按鈕：先跳確認「要把這個旅程標為已完成嗎？」，取消不會標記', async ({ page }) => {
  await login(page);
  await page.goto('/');
  const btn = page.locator('#jtp-list .jtp-complete-btn').first();
  await expect(btn).toHaveText('未完成', { timeout: 6000 });
  await btn.click();
  await expect(page.locator('#confirm-dialog')).toContainText('要把這個旅程標為已完成嗎？');
  await page.locator('#confirm-dialog #cd-no').click();
  await expect(page.locator('#jtp-done-section .jtp-card-done')).toHaveCount(0);
  await expect(btn).toBeVisible();
  await btn.click();
  await page.locator('#confirm-dialog #cd-yes').click();
  await expect(page.locator('#jtp-done-section')).toContainText('大阪');
});

test.describe('跨年行程（12 月 → 隔年 1 月）', () => {
  const addCrossYear = async (page) => {
    await page.clock.setFixedTime(new Date('2026-11-23T08:00:00+08:00'));
    await enterTrip(page);
    await page.evaluate(() => {
      const mk = (day, name) => ({ name, day, arrive: '10:00', depart: '11:30', lat: 34.7, lng: 135.5, category: '住宿', createdAt: 900 });
      window.FB.set('tripgo/groups/TEST01/stops/-y1', mk('Dec 31', '跨年飯店'));
      window.FB.set('tripgo/groups/TEST01/stops/-y2', mk('Jan 1', '退房飯店'));
    });
    await page.waitForFunction(() => S.stops.some((s) => s.name === '退房飯店'));
  };

  test('「Jan 1」會算成隔年 2027-01-01，不是今年的 2026-01-01', async ({ page }) => {
    await addCrossYear(page);
    expect(await page.evaluate(() => labelToDate('Jan 1'))).toBe('2027-01-01');
    expect(await page.evaluate(() => labelToDate('Dec 31'))).toBe('2026-12-31');
    expect(await page.evaluate(() => labelToDate('Jan 1, 2030'))).toBe('2030-01-01');   // 有寫年份的照舊
  });

  test('行程頁排序：Dec 31 在 Jan 1 前面；編輯表單的日期是 2027/01/01', async ({ page }) => {
    await addCrossYear(page);
    const order = await page.evaluate(() => S.stops.map((s) => s.day));
    const sorted = await page.evaluate(() => sortStopsForDisplay(S.stops).map((s) => s.day));
    expect(sorted.indexOf('Dec 31')).toBeLessThan(sorted.indexOf('Jan 1'));
    await page.evaluate(() => { const i = S.stops.findIndex((s) => s.name === '退房飯店'); tapStop(i); setTimeout(() => openInlineEdit(i), 50); });
    await expect(page.locator('#ief-day')).toHaveValue('2027-01-01');
  });

  test('把行程從 12/31 改成 2027/1/1 後再開編輯，日期仍是 2027/1/1', async ({ page }) => {
    await addCrossYear(page);
    await page.evaluate(() => { const i = S.stops.findIndex((s) => s.name === '跨年飯店'); tapStop(i); setTimeout(() => openInlineEdit(i), 50); });
    await page.locator('#ief-day').fill('2027-01-01');
    await page.locator('.exp-ef-save').click();
    await page.waitForFunction(() => S.stops.find((s) => s.name === '跨年飯店').day === 'Jan 1');
    await page.evaluate(() => { const i = S.stops.findIndex((s) => s.name === '跨年飯店'); tapStop(i); setTimeout(() => openInlineEdit(i), 50); });
    await expect(page.locator('#ief-day')).toHaveValue('2027-01-01');
  });

  test('只有同一年的行程，維持原本「今年」的算法', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-01T08:00:00+08:00'));
    await enterTrip(page);
    expect(await page.evaluate(() => labelToDate('Oct 3'))).toBe('2026-10-03');
  });
});

test.describe('跨年行程：第一次載入的畫面順序', () => {
  const seed = (() => {
    const sd = structuredClone(SEED);
    const st = {};
    const mk = (day, name, arrive, n) => ({ name, day, arrive, depart: arrive, lat: 35.1, lng: 129, category: '景點', createdAt: n });
    st['-k1'] = mk('Jan 1', '退房', '10:00', 1);
    st['-k2'] = mk('Jan 1', '機場回程', '12:10', 2);
    st['-k3'] = mk('Dec 24', '桃園機場', '12:40', 3);
    st['-k4'] = mk('Dec 24', '金海機場', '18:50', 4);
    sd.tripgo.groups.TEST01.stops = st;
    return sd;
  })();
  test.use({ seed });
  test('重新開啟時（S.stops 還是空的），Dec 24 的日期標題在 Jan 1 前面', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-23T08:00:00+08:00'));
    await enterTrip(page);
    await expect(page.locator('#stop-list .day-hdr')).toHaveCount(2, { timeout: 8000 });
    const hdrs = await page.locator('#stop-list .day-hdr').evaluateAll((els) => els.map((e) => e.dataset.date));
    expect(hdrs).toEqual(['2026-12-24', '2027-01-01']);
    const names = await page.evaluate(() => S.stops.map((s) => s.name));
    expect(names).toEqual(['桃園機場', '金海機場', '退房', '機場回程']);
  });
});

test.describe('餐廳預訂', () => {
  const openEdit = (page, name) => page.evaluate((n) => { const i = S.stops.findIndex((s) => s.name === n); tapStop(i); setTimeout(() => openInlineEdit(i), 50); }, name);

  test('分類是「餐廳」才出現預訂欄位，且和分類在同一列；切換分類會即時顯示／隱藏', async ({ page }) => {
    await enterTrip(page);
    await openEdit(page, '道頓堀');
    await expect(page.locator('#ief-category')).toBeVisible();
    await expect(page.locator('#ief-resv')).toBeHidden();
    await page.locator('#ief-category').selectOption('餐廳');
    await expect(page.locator('#ief-resv')).toBeVisible();
    await expect(page.locator('#ief-resv-no')).toBeVisible();
    const [c, r, n] = await Promise.all(['#ief-category', '#ief-resv', '#ief-resv-no'].map((sel) => page.locator(sel).boundingBox()));
    expect(Math.abs(c.y - r.y)).toBeLessThan(4);   // 同一列
    expect(Math.abs(c.y - n.y)).toBeLessThan(4);
    expect(c.width).toBeLessThan(r.width * 2);     // 分類不再佔滿整列
    await page.locator('#ief-category').selectOption('景點');
    await expect(page.locator('#ief-resv')).toBeHidden();
  });

  test('存檔寫入 resv / resvNo，再開編輯會帶入；預訂編號含 HTML 只當文字', async ({ page }) => {
    await enterTrip(page);
    await openEdit(page, '道頓堀');
    await page.locator('#ief-category').selectOption('餐廳');
    await page.locator('#ief-resv').selectOption('已訂');
    await page.locator('#ief-resv-no').fill('<b>A123</b>');
    await page.locator('.exp-ef-save').click();
    await page.waitForFunction(() => S.stops.find((s) => s.name === '道頓堀').resvNo === '<b>A123</b>');
    expect(await page.evaluate(() => S.stops.find((s) => s.name === '道頓堀').resv)).toBe('已訂');
    await openEdit(page, '道頓堀');
    await expect(page.locator('#ief-resv')).toHaveValue('已訂');
    await expect(page.locator('#ief-resv-no')).toHaveValue('<b>A123</b>');
    await page.locator('.tab[data-pane="restaurant"]').click();
    const card = page.locator('.rest-card', { hasText: '道頓堀' });
    await expect(card.locator('.rest-resv')).toHaveText('✅ 已訂 #<b>A123</b>');
    await expect(page.locator('#restaurant-list b')).toHaveCount(0);
  });

  test('飲食行程上方統計所有餐廳的預訂狀況', async ({ page }) => {
    await enterTrip(page);
    await page.evaluate(() => {
      const b = 'tripgo/groups/TEST01/stops/';
      const mk = (name, resv, n) => ({ name, day: 'Oct 2', arrive: '1' + n + ':00', lat: 34.7, lng: 135.5, category: '餐廳', resv, createdAt: 800 + n });
      window.FB.set(b + '-r1', mk('甲店', '已訂', 1));
      window.FB.set(b + '-r2', mk('乙店', '已訂', 2));
      window.FB.set(b + '-r3', mk('丙店', '待訂', 3));
      window.FB.set(b + '-r4', mk('丁店', '', 4));
    });
    await page.waitForFunction(() => S.stops.some((s) => s.name === '丁店'));
    await page.locator('.tab[data-pane="restaurant"]').click();
    const sum = page.locator('#rest-resv-sum');
    await expect(sum).toContainText('已訂 2');
    await expect(sum).toContainText('待訂 1');
    await expect(sum).toContainText('未設定');
    await expect(page.locator('.rest-card', { hasText: '丙店' }).locator('.rest-resv')).toHaveText('⏳ 待訂');
  });

  test('新增景點時選「餐廳」也可以填預訂', async ({ page }) => {
    await enterTrip(page);
    await page.evaluate(() => openNewStopForm({ day: '2026-10-02' }));
    await expect(page.locator('#ief-resv')).toBeHidden();
    await page.locator('#ief-name').fill('新餐廳');
    await page.locator('#ief-category').selectOption('餐廳');
    await page.locator('#ief-resv').selectOption('待訂');
    await page.locator('#ief-resv-no').fill('X9');
    await page.locator('#ief-save').click();
    await page.waitForFunction(() => S.stops.some((s) => s.name === '新餐廳'));
    const s = await page.evaluate(() => S.stops.find((x) => x.name === '新餐廳'));
    expect([s.resv, s.resvNo]).toEqual(['待訂', 'X9']);
  });
});

test.describe('住宿預訂', () => {
  const openEdit = (page, name) => page.evaluate((n) => { const i = S.stops.findIndex((s) => s.name === n); tapStop(i); setTimeout(() => openInlineEdit(i), 50); }, name);
  test('分類「住宿」也有預訂欄位；存檔後行程頁的分類旁顯示「已訂 #編號」', async ({ page }) => {
    await enterTrip(page);
    await openEdit(page, '道頓堀');
    await page.locator('#ief-category').selectOption('住宿');
    await expect(page.locator('#ief-resv')).toBeVisible();
    await page.locator('#ief-resv').selectOption('已訂');
    await page.locator('#ief-resv-no').fill('HTL-88');
    await page.locator('.exp-ef-save').click();
    await page.waitForFunction(() => S.stops.find((s) => s.name === '道頓堀').resvNo === 'HTL-88');
    await expect(page.locator('#stop-list .resv-tag.r-yes')).toHaveText('✅ 已訂 #HTL-88');
    await openEdit(page, '道頓堀');
    await expect(page.locator('#ief-resv')).toHaveValue('已訂');
  });
  test('景點、其他分類沒有預訂欄位；沒設定預訂的不顯示標籤', async ({ page }) => {
    await enterTrip(page);
    await expect(page.locator('#stop-list .resv-tag')).toHaveCount(0);
    await openEdit(page, '道頓堀');
    for (const c of ['景點', '其他', '']) {
      await page.locator('#ief-category').selectOption(c);
      await expect(page.locator('#ief-resv')).toBeHidden();
    }
  });
});

// 讀取 App 產生的 .xlsx（未壓縮 zip），不依賴外部套件：檢查 zip 結構、取出 sheet1 的儲存格文字
function readXlsx(file) {
  const buf = readFileSync(file);
  const files = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    expect(buf.readUInt16LE(p + 8)).toBe(0);   // stored
    const size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nlen);
    files[name] = buf.toString('utf8', p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    p += 30 + nlen + xlen + size;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);   // end of central directory
  for (const k of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) expect(files[k]).toBeTruthy();
  const un = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return [...files['xl/worksheets/sheet1.xml'].matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<t[^>]*>(.*?)<\/t>/g)].map((c) => un(c[1])));
}

test.describe('食住規畫', () => {
  const addStays = (page) => page.evaluate(() => {
    const b = 'tripgo/groups/TEST01/stops/';
    window.FB.set(b + '-h1', { name: 'Anook Hotel', day: 'Oct 2', arrive: '15:00', lat: 34.7, lng: 135.5, category: '住宿', resv: '已訂', resvNo: 'H-1', note: '含早餐', createdAt: 901 });
    window.FB.set(b + '-h2', { name: '京都旅館', day: 'Oct 3', arrive: '16:00', lat: 35, lng: 135.7, category: '住宿', resv: '待訂', createdAt: 902 });
    window.FB.set(b + '-f1', { name: '一蘭拉麵', day: 'Oct 3', arrive: '12:00', lat: 34.7, lng: 135.5, category: '餐廳', resv: '已訂', resvNo: 'R-7', createdAt: 903 });
  });
  test('分頁名稱是「食住規畫」，內頁分「飲食」「住宿」；每筆一行：日期＋時間＋名稱', async ({ page }) => {
    await enterTrip(page);
    await addStays(page);
    await page.waitForFunction(() => S.stops.some((s) => s.name === '京都旅館'));
    await page.locator('.tab[data-pane="restaurant"]').click();
    await expect(page.locator('#pane-restaurant')).toContainText('食住規畫');
    await expect(page.locator('.rest-sub[data-sub="food"]')).toHaveClass(/on/);
    const r = page.locator('.rest-row', { hasText: '一蘭拉麵' });
    await expect(r.locator('.rr-date')).toHaveText('10/3（六）');
    await expect(r.locator('.rr-time')).toHaveText('12:00');
    const [d, n] = await Promise.all([r.locator('.rr-date').boundingBox(), r.locator('.rr-name').boundingBox()]);
    expect(Math.abs(d.y + d.height / 2 - (n.y + n.height / 2))).toBeLessThan(4);   // 同一行
    await expect(page.locator('#restaurant-list')).not.toContainText('Anook Hotel');
    await page.locator('.rest-sub[data-sub="stay"]').click();
    await expect(page.locator('.rest-row')).toHaveCount(2);
    await expect(page.locator('.rest-row').first()).toContainText('Anook Hotel');
    await expect(page.locator('#rest-resv-sum')).toContainText('已訂 1');
    await expect(page.locator('#rest-resv-sum')).toContainText('待訂 1');
    await expect(page.locator('#restaurant-list')).not.toContainText('一蘭拉麵');
  });

  for (const [sub, label, first, count] of [['food', '飲食', null, null], ['stay', '住宿', 'Anook Hotel', 2]]) {
    test('最下方「產出 Excel（' + label + '）」下載可開啟的 .xlsx，內容正確', async ({ page }) => {
      await enterTrip(page);
      await addStays(page);
      await page.waitForFunction(() => S.stops.some((s) => s.name === '京都旅館'));
      await page.locator('.tab[data-pane="restaurant"]').click();
      await page.locator('.rest-sub[data-sub="' + sub + '"]').click();
      const btn = page.locator('#rest-xlsx');
      await expect(btn).toHaveText('📥 產出 Excel（' + label + '）');
      const want = await page.evaluate((s) => restItems(s).map((x) => x.name), sub);
      const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
      expect(dl.suggestedFilename()).toMatch(new RegExp(label + '\\.xlsx$'));
      const f = test.info().outputPath('out.xlsx'); await dl.saveAs(f);
      const rows = readXlsx(f);
      expect(rows[0]).toEqual(['日期', '時間', '名稱', '預訂狀態', '預訂編號', '備註']);
      expect(rows.slice(1).map((r) => r[2])).toEqual(want);
      if (first) {
        expect(rows.length - 1).toBe(count);
        expect(rows[1]).toEqual(['2026/10/02（五）', '15:00', 'Anook Hotel', '已預訂', 'H-1', '含早餐']);
      } else {
        expect(rows.find((r) => r[2] === '一蘭拉麵').slice(3, 5)).toEqual(['已預訂', 'R-7']);
      }
    });
  }
});

test.describe('上方標題列', () => {
  for (const w of [390, 360]) {
    test('手機寬度 ' + w + 'px：行程名稱 20px 完整顯示；名字縮寫 20px、靠右緊貼連線圖示；高度不變', async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await enterTrip(page);
      await page.evaluate(() => startApp(S.groupCode, S.myUid, 'Albert SHIUE', "Busan X'mas", S.isOrg));
      await page.evaluate(() => { document.getElementById('tb-trip').textContent = "Busan X'mas"; });
      const m = await page.evaluate(() => {
        const t = document.getElementById('tb-trip'), n = document.getElementById('tb-myname'), ns = document.getElementById('net-status');
        const vis = [...document.querySelectorAll('.topbar > *')].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0);
        const nr = n.getBoundingClientRect(), sr = ns.getBoundingClientRect();
        return { h: document.querySelector('.topbar').getBoundingClientRect().height, fs: getComputedStyle(t).fontSize, nfs: getComputedStyle(n).fontSize,
          full: t.scrollWidth <= t.clientWidth + 1, order: vis.slice(-2).map((e) => e.id), gap: sr.left - nr.right, nsText: ns.innerText.trim(),
          right: Math.max(...vis.map((e) => e.getBoundingClientRect().right)), text: n.textContent };
      });
      expect(m.fs).toBe('20px');
      expect(m.nfs).toBe('20px');
      expect(m.text).toBe('AL');
      expect(m.full).toBe(true);
      expect(m.h).toBeLessThanOrEqual(45);
      expect(m.order).toEqual(['tb-myname', 'net-status']);
      expect(m.gap).toBeLessThanOrEqual(10);   // 挨在一起
      expect(m.nsText).toBe('');
      expect(m.right).toBeLessThanOrEqual(w);
      await expect(page.locator('#btn-share-trip')).toHaveCount(0);
      await expect(page.locator('.tb-logo')).toContainText('TripGo');
    });
  }
  test('名字縮寫：完整名字放在提示；點了切到團員列表', async ({ page }) => {
    await enterTrip(page);
    await page.evaluate(() => startApp(S.groupCode, S.myUid, 'Albert SHIUE', S.tripName, S.isOrg));
    await expect(page.locator('#tb-myname')).toHaveText('AL');
    await expect(page.locator('#tb-myname')).toHaveAttribute('title', /Albert SHIUE/);
    await page.locator('#tb-myname').click();
    await expect(page.locator('#pane-locations')).toHaveClass(/on/);
  });
});


test('首頁旅程卡片：「匯出」換成「分享」，點了複製分享連結，不會進入旅程', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.goto('/');
  const btn = page.locator('#jtp-list .jtp-share-btn').first();
  await expect(btn).toHaveText('分享', { timeout: 6000 });
  await expect(page.locator('#jtp-list', { hasText: '匯出' })).toHaveCount(0);
  await btn.click();
  await expect(page.locator('#toast, .toast').first()).toContainText('分享連結已複製');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('?view=TEST01');
  await expect(page.locator('#S-app.show')).toHaveCount(0);   // 點分享不會進入旅程
});

test('團員列表維持原樣：順序不變、沒有「這台裝置」與登出按鈕', async ({ page }) => {
  await enterTrip(page);
  await page.locator('.tab[data-pane="locations"]').click();
  const names = await page.locator('#mem-list .mem-clist-row .mem-nm').evaluateAll((els) => els.map((e) => e.firstChild.textContent));
  expect(names).toEqual(await page.evaluate(() => uniqueMembers().map((m) => m.name)));
  await expect(page.locator('#mem-list')).not.toContainText('這台裝置');
  await expect(page.locator('#mem-list .mem-logout-btn')).toHaveCount(0);
});

test.describe('地圖：從 A 點點到 B 景點', () => {
  const spy = (page) => page.evaluate(() => {
    window.__fit = []; window.__mk = [];
    map.fitBounds = (b, pad) => { window.__fit.push(b.pts.map((p) => [p.lat(), p.lng()])); window.__pad = pad; };
    const M = google.maps.Marker;
    google.maps.Marker = function (o) { const m = new M(o); window.__mk.push(m); return m; };
  });
  const tap = async (page, name) => {
    await page.evaluate((n) => tapStop(S.stops.findIndex((s) => s.name === n)), name);
    await page.waitForFunction(() => !_pairAnimating);   // 等微動畫跑完
  };
  // op：1 = 一般標記，'prev' = 上一個景點（淡色填色＋深藍實線外框，外框不透明）
  const live = (page) => page.evaluate(() => window.__mk.filter((m) => m.getMap() && m !== _pairLabel).map((m) => {   // 不含時間標籤
    const svg = decodeURIComponent((m.opts.icon && m.opts.icon.url || '').split(',')[1] || '');
    const prev = /fill="rgba\(43,95,142,0\.3\)" stroke="#1a3a5c" stroke-width="2"/.test(svg);
    return { t: m.opts.title, op: (m.opts.opacity == null || m.opts.opacity === 1) ? (prev ? 'prev' : 1) : m.opts.opacity };
  }));

  test('先點 A 再點 B：地圖同時框住 A 和 B，A 是淡色＋深藍外框、B 正常', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    await tap(page, '大阪城');
    expect(await page.evaluate(() => window.__fit.length)).toBe(0);   // 第一個點：照舊置中
    await tap(page, '道頓堀');
    const [A, B] = await page.evaluate(() => ['大阪城', '道頓堀'].map((n) => { const s = S.stops.find((x) => x.name === n); return [+s.lat, +s.lng]; }));
    const fit = await page.evaluate(() => window.__fit);
    expect(fit.length).toBeGreaterThanOrEqual(1);
    const key = (p) => p.join(',');
    expect(fit.every((f) => f.every((p) => [key(A), key(B)].includes(key(p))) && f.some((p) => key(p) === key(A)) && f.some((p) => key(p) === key(B)))).toBe(true);
    const m = await live(page);
    expect(m).toEqual(expect.arrayContaining([{ t: '道頓堀', op: 1 }, { t: '大阪城（上一個）', op: 'prev' }]));
    expect(m.length).toBe(2);
  });

  test('框住兩點時，下方預留景點資訊卡蓋住的高度（兩個點不會被資訊卡遮住）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterTrip(page);
    await spy(page);
    await tap(page, '大阪城');
    await tap(page, '道頓堀');
    await expect(page.locator('#place-card.show')).toBeVisible();
    await page.waitForTimeout(100);   // 資訊卡出現後的重新框選
    const r = await page.evaluate(() => {
      const a = map.getDiv().getBoundingClientRect(), c = document.getElementById('place-card').getBoundingClientRect();
      return { cover: Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top), pad: window.__pad, H: a.height };
    });
    expect(r.cover).toBeGreaterThan(40);
    expect(r.pad.bottom).toBeGreaterThanOrEqual(Math.min(r.cover + 40, r.H - 140));
    expect(r.H - r.pad.top - r.pad.bottom).toBeGreaterThanOrEqual(60);   // 兩點仍有空間
  });

  test('微動畫：A 先淡出 → 從 A 往 B 畫線 → 最後 B 標記落下；結束後線停在 A→B', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    await tap(page, '大阪城');
    await page.evaluate(() => {
      window.__frames = [];
      const loop = () => {
        const a = prevMarker, svg = a ? decodeURIComponent((a.opts.icon.url || '').split(',')[1]) : '';
        window.__frames.push({ anim: _pairAnimating, aFill: (svg.match(/fill="rgba\(43,95,142,([\d.]+)\)"/) || [])[1], line: _pairLine ? _pairLine.opts.path.length : 0,
          lineLen: _pairLine ? Math.hypot(_pairLine.opts.path[1].lat - _pairLine.opts.path[0].lat, _pairLine.opts.path[1].lng - _pairLine.opts.path[0].lng) : 0,
          bDropped: !!(stopMarker && stopMarker.getMap()) });
        if (window.__frames.length < 400) requestAnimationFrame(loop);
      };
      tapStop(S.stops.findIndex((s) => s.name === '道頓堀')); loop();
    });
    await page.waitForFunction(() => !_pairAnimating);
    const f = await page.evaluate(() => window.__frames.filter((x) => x.anim));
    expect(f.length).toBeGreaterThan(10);
    const fills = f.map((x) => +x.aFill).filter((x) => x);
    expect(fills[0]).toBeGreaterThan(0.6);                    // 一開始還是實心
    expect(Math.min(...fills)).toBeLessThan(0.4);            // 漸漸變淡
    const lens = f.map((x) => x.lineLen);
    expect(lens.some((l) => l > 0 && l < Math.max(...lens) * 0.9)).toBe(true);   // 線是一段一段長出來
    expect(f.every((x) => !x.bDropped)).toBe(true);         // 動畫中 B 還沒落下
    expect(await page.evaluate(() => !!stopMarker.getMap() && stopMarker.opts.animation === google.maps.Animation.DROP)).toBe(true);
    const line = await page.evaluate(() => _pairLine.opts.path.map((p) => [+(p.lat.call ? p.lat() : p.lat), +(p.lng.call ? p.lng() : p.lng)]));
    const [A, B] = await page.evaluate(() => ['大阪城', '道頓堀'].map((n) => { const s = S.stops.find((x) => x.name === n); return [+s.lat, +s.lng]; }));
    expect(line).toEqual([A, B]);
  });

  test('動畫中又點別的景點：立刻中止，不留下畫一半的線或多的標記', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    const names = await page.evaluate(() => S.stops.filter((s) => +s.lat).map((s) => s.name).slice(0, 3));
    await tap(page, names[0]);
    await page.evaluate((n) => tapStop(S.stops.findIndex((s) => s.name === n)), names[1]);
    await page.waitForTimeout(120);   // 動畫進行中
    await tap(page, names[2]);
    await page.waitForTimeout(1500);   // 舊動畫若沒中止，這時會跑完並多出標記
    expect(await live(page)).toEqual([{ t: names[2], op: 1 }]);
    expect(await page.evaluate(() => _pairLine)).toBe(null);
  });

  test('系統開啟「減少動態效果」時不播動畫，直接顯示最後畫面', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterTrip(page);
    await spy(page);
    await tap(page, '大阪城');
    await page.evaluate(() => tapStop(S.stops.findIndex((s) => s.name === '道頓堀')));
    expect(await page.evaluate(() => _pairAnimating)).toBe(false);
    expect(await live(page)).toEqual(expect.arrayContaining([{ t: '道頓堀', op: 1 }, { t: '大阪城（上一個）', op: 'prev' }]));
  });

  // 假的 Google 路線：DRIVING 可以設成查不到（模擬韓國），回傳一條經過中間點的路線
  const fakeRoutes = (page, { noDriving = false, secs = 1500 } = {}) => page.evaluate(({ noDriving, secs }) => {
    window.__reqs = [];
    dsvc.route = (req, cb) => {
      window.__reqs.push(req.travelMode);
      if (noDriving && req.travelMode === 'DRIVING') return cb({ routes: [] }, 'ZERO_RESULTS');
      const a = req.origin, b = req.destination, LL = google.maps.LatLng;
      const path = [new LL(a.lat, a.lng), new LL(a.lat + 0.01, (a.lng + b.lng) / 2), new LL(b.lat, b.lng)];
      cb({ routes: [{ overview_path: path, legs: [{ duration: { value: req.travelMode === 'TRANSIT' ? 2400 : secs } }] }] }, 'OK');
    };
  }, { noDriving, secs });
  const pairInfo = (page) => page.evaluate(() => ({
    label: _pairLabel && _pairLabel.getMap() ? _pairLabel._txt : null,
    n: _pairLine ? _pairLine.opts.path.length : 0, color: _pairLine && _pairLine.opts.strokeColor }));

  test('A→B 沿 Google 駕車路線畫橘色線，並在路線上標示預估時間', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    await fakeRoutes(page);
    await tap(page, '大阪城');
    await tap(page, '道頓堀');
    const r = await pairInfo(page);
    expect(r.n).toBe(3);                    // 沿路線（經過中間點），不是直線
    expect(r.color).toBe('#E8710A');        // 橘色，和每天路線的藍色區分
    expect(r.label).toBe('🚗 約 25 分');
    expect(await page.evaluate(() => window.__reqs)).toEqual(['DRIVING']);
  });

  test('查不到駕車路線（例如韓國）時改用大眾運輸；B 的前段交通是步行就用步行', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    await fakeRoutes(page, { noDriving: true });
    await tap(page, '大阪城');
    await tap(page, '道頓堀');
    expect((await pairInfo(page)).label).toBe('🚌 約 40 分（大眾運輸）');
    expect(await page.evaluate(() => window.__reqs)).toEqual(['DRIVING', 'TRANSIT']);
    await page.evaluate(() => { const s = S.stops.find((x) => x.name === '大阪城'); s.transit = { mode: 'walk', minutes: 10 }; });
    await tap(page, '大阪城');
    expect((await pairInfo(page)).label).toBe('🚶 約 25 分');
  });

  test('路線查不到時畫直線並標示直線距離；同一段路第二次不再重查', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    await page.evaluate(() => { window.__reqs = []; const o = dsvc.route; dsvc.route = (req, cb) => { window.__reqs.push(req.travelMode); return o(req, cb); }; });
    await tap(page, '大阪城');
    await tap(page, '道頓堀');
    const r = await pairInfo(page);
    expect(r.n).toBe(2);
    expect(r.label).toMatch(/^📏 直線 [\d.]+ km（查不到路線）$/);
    await fakeRoutes(page);
    await tap(page, '大阪城');
    await tap(page, '道頓堀');
    const n1 = await page.evaluate(() => window.__reqs.length);
    await tap(page, '大阪城');
    await tap(page, '道頓堀');
    expect(await page.evaluate(() => window.__reqs.length)).toBe(n1);   // 快取
  });

  test('再點 C：只保留 B 當淡色的上一個點；收起景點時兩個標記都清掉', async ({ page }) => {
    await enterTrip(page);
    await spy(page);
    const names = await page.evaluate(() => S.stops.filter((s) => +s.lat).map((s) => s.name).slice(0, 3));
    for (const n of names) await tap(page, n);
    const m = await live(page);
    expect(m).toEqual(expect.arrayContaining([{ t: names[2], op: 1 }, { t: names[1] + '（上一個）', op: 'prev' }]));
    expect(m.length).toBe(2);
    await tap(page, names[2]);   // 再點一次 = 收起
    expect(await live(page)).toEqual([]);
    await tap(page, names[0]);   // 收起後再點：沒有上一個點
    expect(await live(page)).toEqual([{ t: names[0], op: 1 }]);
  });
});

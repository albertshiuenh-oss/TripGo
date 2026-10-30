import { test, expect, enterTrip, login, writes, SEED } from './harness.mjs';


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

  test('餐廳頁：今天的日期標題有標示，切換進來時自動置中', async ({ page }) => {
    await page.addInitScript((s) => { window.__TG_SEED = s; }, longTrip());
    await page.clock.setFixedTime(new Date('2026-10-10T12:00:00+08:00'));
    await enterTrip(page);
    await page.locator('.tab[data-pane="restaurant"]').click();
    const hdr = page.locator('.rest-day-hdr.day-today');
    await expect(hdr).toHaveCount(1);
    await expect(hdr).toContainText('Oct 10');
    await expect(hdr.locator('.day-badge')).toHaveText('今天');
    await expect.poll(() => page.evaluate(() => {
      const box = document.getElementById('restaurant-list').getBoundingClientRect();
      const h = document.querySelector('.rest-day-hdr.day-today');
      const a = h.getBoundingClientRect(), z = h.nextElementSibling.getBoundingClientRect();
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
    renderTripsPreview('Anna', true);
  });
  await expect(page.locator('#jtp-list .jtp-complete-btn')).toHaveCount(1);
  expect(await page.locator('#jtp-list .jtp-del').count()).toBe(0);
  await page.locator('#jtp-list .jtp-complete-btn').click();
  await page.locator('#confirm-dialog button', { hasText: '確定完成' }).click();
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
    await page.locator('#login-name').pressSequentially('Albert', { delay: 40 });
    await expect(page.locator('#login-hint')).toContainText('找到帳號');
    const n = await page.evaluate(() => window.__fbStub.reads.filter((p) => p.startsWith('tripgo/accounts/')).length);
    expect(n).toBe(1);
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

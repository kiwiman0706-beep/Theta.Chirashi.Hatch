// The app's screen in Chromium with a stand-in for the Java bridge and for Google's APIs.
// NODE_PATH=$(npm root -g) node test/ui.e2e.cjs [screenshot-dir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const WWW = path.join(__dirname, '../android/app/src/main/assets/www');
const IMG = process.env.SAMPLE_IMAGES ? process.env.SAMPLE_IMAGES.split(',') : [];
const shots = process.argv[2];
const answer = fs.readFileSync(path.join(__dirname, 'sample-answer.json'), 'utf8');

function sampleJpeg(i) {
  if (IMG[i]) return fs.readFileSync(IMG[i]);
  // a tiny grey JPEG
  return Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const media = {};
  await page.route('https://app.test/**', async (route) => {
    const u = new URL(route.request().url());
    let p = u.pathname.replace(/^\//, '');
    const m = /^(media|incoming)\/(.+)$/.exec(p);
    if (m) {
      const key = m[2];
      const body = media[key] || sampleJpeg(Object.keys(media).length % 3);
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body });
    }
    if (!p) p = 'index.html';
    const f = path.join(WWW, p);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  const calls = [];
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    calls.push('gemini');
    const body = JSON.parse(route.request().postData());
    if (!body.contents[0].parts.some((p) => p.inline_data)) throw new Error('no images sent');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }) });
  });
  await page.route('https://www.googleapis.com/**', (route) => {
    const u = route.request().url();
    const method = route.request().method();
    calls.push(method + ' ' + u.replace(/\?.*/, ''));
    if (u.includes('/calendarList')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'me@example.com', summary: 'me@example.com', primary: true }] }) });
    if (u.includes('/upload/drive')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'f' + calls.length, webViewLink: 'https://drive.google.com/file/d/f' + calls.length + '/view', name: 'x.jpg', mimeType: 'image/jpeg' }) });
    if (u.includes('/drive/v3/files')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'folder1' }) });
    if (u.includes('/calendar/v3/calendars/')) {
      const ev = JSON.parse(route.request().postData() || '{}');
      if (!ev.attachments || !ev.attachments.length) throw new Error('no attachments');
      if (!/■プログラム/.test(ev.description)) throw new Error('no program in description');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'ev1', htmlLink: 'https://calendar.google.com/event?eid=1' }) });
    }
    route.fulfill({ status: 404, body: '{}' });
  });
  await page.addInitScript(() => {
    let data = '';
    let key = '';
    const reply = (id, d) => setTimeout(() => window.AndroidReply(id, d), 30);
    window.__opened = [];
    window.AndroidNative = {
      info: () => JSON.stringify({ version: '0.1.0', package: 'jp.yaegaki.theta.chirashi', sha1: '75:5E:7B:B7' }),
      secretGet: () => key,
      secretSet: (v) => (key = v),
      loadData: () => data,
      saveData: (j) => ((data = j), ''),
      keep: () => '',
      writeMedia: () => '',
      deleteMedia: () => {},
      call: (method, json, id) => {
        const a = JSON.parse(json);
        if (method === 'scan') return reply(id, { files: [{ name: 'p1.jpg', path: 'incoming/p1.jpg' }, { name: 'p2.jpg', path: 'incoming/p2.jpg' }, { name: 'p3.jpg', path: 'incoming/p3.jpg' }] });
        if (method === 'qr') return reply(id, { codes: [] });
        if (method === 'token') return reply(id, { token: 't', email: 'me@example.com' });
        if (method === 'openUrl' || method === 'calendarIntent' || method === 'contactIntent' || method === 'copyText' || method === 'share') {
          window.__opened.push(method + ' ' + (a.url || a.title || a.name || ''));
          return reply(id, {});
        }
        reply(id, { error: 'unknown ' + method });
      }
    };
  });
  await page.goto('https://app.test/index.html');
  await page.waitForSelector('.empty');
  if (shots) await page.screenshot({ path: path.join(shots, '0-empty.png') });

  // settings: key
  await page.click('#btn-settings');
  await page.fill('#s-key', 'AIzaTEST');
  await page.click('[data-act=savekey]');
  if (shots) await page.screenshot({ path: path.join(shots, '5-settings.png') });
  await page.click('[data-act=guide]');
  await page.waitForSelector('text=SHA-1 証明書フィンガープリント');
  await page.click('[data-act=back]');
  await page.click('[data-act=back]');

  // scan → read
  await page.click('#btn-scan');
  await page.waitForSelector('h1.title:has-text("Higashi-Osaka")', { timeout: 15000 });
  await page.waitForSelector('#busy', { state: 'hidden' });
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: path.join(shots, '1-detail.png') });
  if (shots) await page.screenshot({ path: path.join(shots, '1-detail-full.png'), fullPage: false, clip: undefined });
  const text = await page.textContent('.sheet');
  for (const want of ['ホテルアウィーナ大阪', '橋田 亜由美', '山田 太郎', 'VEM-JP-37298', '2026年11月28日（土）', '17:00〜18:30']) if (!text.includes(want)) throw new Error('missing ' + want);

  // memo, then register
  await page.fill('#memo', '参加予定。17時までに到着');
  await page.dispatchEvent('#memo', 'change');
  await page.click('[data-act=register]');
  await page.waitForSelector('.status.ok:has-text("Googleカレンダーに登録済み")', { timeout: 15000 });
  if (!calls.some((c) => c.startsWith('POST https://www.googleapis.com/calendar/v3/calendars/primary/events'))) throw new Error('no event created: ' + calls.join('\n'));
  if (calls.filter((c) => c.includes('/upload/drive')).length !== 3) throw new Error('expected 3 uploads');

  // other buttons
  await page.click('[data-contact="0"]');
  await page.click('[data-act=map]');
  await page.click('[data-view="1"]');
  await page.waitForSelector('.viewer');
  await page.click('.viewer [data-act=back]');

  // edit
  await page.click('[data-act=edit]');
  await page.fill('[data-f="online.url"]', 'https://zoom.us/j/999');
  await page.click('[data-act=saveedit]');
  await page.waitForSelector('button:has-text("Zoomを開く"), button:has-text("Webを開く")');
  const overflow = await page.evaluate(() => document.querySelector('.sheet').scrollWidth - document.querySelector('.sheet').clientWidth);
  if (overflow > 0) throw new Error('detail overflows horizontally by ' + overflow);
  await page.click('.sheet-head [data-act=back]');

  // list & calendar
  await page.click('[data-filter=all]');
  await page.waitForSelector('.item');
  if (shots) await page.screenshot({ path: path.join(shots, '2-list.png') });
  await page.click('[data-tab=cal]');
  await page.click('[data-month="1"]');
  await page.click('[data-month="-1"]');
  await page.evaluate(() => {});
  // go to November 2026
  for (let i = 0; i < 24; i++) {
    const ym = await page.textContent('.ym');
    if (ym === '2026年11月') break;
    await page.click(ym < '2026年11月' ? '[data-month="1"]' : '[data-month="-1"]');
  }
  await page.click('[data-day="2026-11-28"]');
  await page.waitForSelector('.day-title:has-text("11月28日")');
  if (!(await page.$('.cell .ev'))) throw new Error('no event in the month grid');
  if (shots) await page.screenshot({ path: path.join(shots, '3-calendar.png') });
  for (const w of [320, 768]) {
    await page.setViewportSize({ width: w, height: 800 });
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) throw new Error('page overflows at ' + w + 'px by ' + o);
  }
  // back button
  const back = await page.evaluate(() => window.handleBack());
  if (back !== true) throw new Error('back from the calendar tab should go to the list');
  if (errors.length) throw new Error('JS errors:\n' + errors.join('\n'));
  console.log('UI OK —', calls.length, 'API calls;', (await page.evaluate(() => window.__opened)).join(', '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

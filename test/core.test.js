const test = require('node:test');
const assert = require('node:assert');
const Core = require('../android/app/src/main/assets/www/core.js');
const answer = require('./sample-answer.json');

test('the flyer, its map and a card become one record', () => {
  const recs = Core.toRecords(answer, ['a.jpg', 'b.jpg', 'c.jpg'], [], new Date(2026, 10, 6));
  assert.strictEqual(recs.length, 1);
  const r = recs[0];
  assert.deepStrictEqual(r.pages.map((p) => p.kind), ['flyer', 'map', 'card']);
  assert.strictEqual(r.cards[0].name, '山田 太郎');
  assert.strictEqual(r.program[0].people[0].name, '橋田 亜由美'); // 「先生」は外す
  const body = Core.calendarBody(r, [{ title: '1枚目', url: 'https://drive/x' }], [{ fileUrl: 'https://drive/x' }]);
  assert.deepStrictEqual(body.start, { dateTime: '2026-11-28T17:00:00', timeZone: 'Asia/Tokyo' });
  assert.deepStrictEqual(body.end, { dateTime: '2026-11-28T18:30:00', timeZone: 'Asia/Tokyo' });
  assert.match(body.location, /ホテルアウィーナ大阪 3階 芙蓉（〒543-0031/);
  assert.match(body.description, /座長：橋田 亜由美 先生（医療福祉生活協同組合おおさか/);
  assert.match(body.description, /■担当者（名刺）\n・山田 太郎　日本イーライリリー株式会社 大阪営業所 MR　090-0000-0000/);
  assert.match(body.description, /1枚目：https:\/\/drive\/x/);
  assert.strictEqual(body.attachments.length, 1);
});

test('a Zoom link found only in a QR code makes the event online', () => {
  const a = JSON.parse(JSON.stringify(answer));
  a.events[0].venue = '';
  a.events[0].address = '';
  const r = Core.toRecords(a, ['a.jpg'], [{ page: 1, raw: 'https://us02web.zoom.us/j/123?pwd=x' }], new Date(2026, 10, 6))[0];
  assert.strictEqual(r.format, 'online');
  assert.strictEqual(r.online.platform, 'Zoom');
  assert.strictEqual(Core.eventTitle(r), '【Web】Higashi-Osaka AD Care Network Conference');
  assert.strictEqual(Core.location(r), 'https://us02web.zoom.us/j/123?pwd=x');
});

test('only business cards → one record without a date', () => {
  const r = Core.toRecords({ events: [], cards: [{ name: '佐藤 花子', company: 'みどり製薬' }], pages: [{ index: 0, kind: 'card' }] }, ['a.jpg'], [], new Date())[0];
  assert.strictEqual(r.title, '名刺：佐藤 花子（みどり製薬）');
  assert.strictEqual(r.date, '');
  assert.throws(() => Core.calendarBody(r));
});

test('dates and times', () => {
  const today = new Date(2026, 10, 6);
  assert.strictEqual(Core.normDate('2026年1月5日', today), '2026-01-05');
  assert.strictEqual(Core.normDate('1/15', today), '2027-01-15');
  assert.strictEqual(Core.normDate('11/28', today), '2026-11-28');
  assert.strictEqual(Core.normTime('9:5'), '09:05');
  assert.strictEqual(Core.normTime('１７：３０'), '17:30');
  assert.strictEqual(Core.normTime('25:00'), '');
  assert.strictEqual(Core.dateLabel('2026-11-28', true), '2026年11月28日（土）');
  const allDay = Core.calendarBody({ title: 'x', date: '2026-12-01', endDate: '2026-12-02', format: 'onsite' });
  assert.deepStrictEqual(allDay.end, { date: '2026-12-03' });
  const noEnd = Core.calendarBody({ title: 'x', date: '2026-12-01', start: '19:00', format: 'onsite' });
  assert.strictEqual(noEnd.end.dateTime, '2026-12-01T20:30:00');
  const t = Core.intentTimes({ date: '2026-11-28', start: '17:00', end: '18:30' });
  assert.strictEqual(t.begin, Date.parse('2026-11-28T08:00:00Z'));
  assert.strictEqual(t.end - t.begin, 90 * 60000);
});

test('answers wrapped in a code fence', () => {
  assert.deepStrictEqual(Core.parseAnswer('```json\n{"events":[]}\n```'), { events: [] });
});

test('search and markdown', () => {
  const r = Object.assign(Core.toRecords(answer, ['a.jpg', 'b.jpg', 'c.jpg'], [], new Date(2026, 10, 6))[0], { id: 'x1' });
  assert.ok(Core.matches(r, '岡田 ケサンラ'));
  assert.ok(!Core.matches(r, '東京'));
  assert.match(Core.markdown(r), /^---\ntype: chirashi\/event@1\nid: x1/);
});

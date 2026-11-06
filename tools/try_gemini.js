// Reads flyer pictures with the app's own prompt (android/app/src/main/assets/www/core.js) and
// prints the answer and the calendar memo. Usage: GEMINI_API_KEY=... node tools/try_gemini.js a.jpg b.jpg
const fs = require('fs');
const path = require('path');
const Core = require('../android/app/src/main/assets/www/core.js');
(async () => {
  const files = process.argv.slice(2);
  const model = process.env.MODEL || 'gemini-2.5-flash';
  const parts = [{ text: Core.prompt(Core.ymd(new Date()), []) }];
  files.forEach((f, i) => {
    parts.push({ text: '--- ページ' + (i + 1) + '（index ' + i + '） ---' });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  });
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || 'dummy' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j));
  const answer = Core.parseAnswer(j.candidates[0].content.parts.map((p) => p.text || '').join(''));
  console.log(JSON.stringify(answer, null, 1));
  const recs = Core.toRecords(answer, files.map((f) => path.basename(f)), [], new Date());
  recs.forEach((r) => {
    console.log('\n===== ' + Core.eventTitle(r) + ' / ' + Core.location(r));
    console.log(JSON.stringify(Core.calendarBody(r, [], []).start), JSON.stringify(Core.calendarBody(r, [], []).end));
    console.log(Core.description(r, [{ title: '1枚目', url: 'https://drive.google.com/…' }]));
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

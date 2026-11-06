// Google: Gemini (reading the flyer), Drive (keeping the pictures) and Calendar (the event).
// Every call uses the user's own key / account (Theta Hatch spec §5).
(function () {
  'use strict';

  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/';

  function geminiAdvice(status, body) {
    const b = body || '';
    if (status === 429) return /PerDay|per day|daily/i.test(b) ? 'Geminiの1日の無料枠を使い切りました。日本時間の夕方に枠が戻ります。' : 'Geminiの1分あたりの上限です。少し待ってから「もう一度読み取る」を押してください。';
    if (/API_KEY_INVALID|API key not valid|expired/i.test(b) || status === 401) return 'Gemini APIキーが無効です。設定でキーを入れ直してください。';
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(b)) return 'このAPIキーのプロジェクトでGemini APIが有効になっていません。Google AI Studioでキーを作り直してください。';
    if (status === 403) return 'Gemini APIへのアクセスが拒否されました（キーの制限・請求設定を確認してください）。';
    if (status === 404) return 'このモデルは使えません。設定でモデルを選び直してください。';
    return 'Geminiでの読み取りに失敗しました（HTTP ' + status + '）。';
  }

  // images: [{mime, data(base64)}]
  async function geminiRead(key, model, promptText, images) {
    if (!key) throw new Error('設定でGemini APIキーを入力してください');
    if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error('モデル名が不正です');
    const parts = [{ text: promptText }];
    images.forEach((im, i) => {
      parts.push({ text: '--- ページ' + (i + 1) + '（index ' + i + '） ---' });
      parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
    });
    const res = await fetch(GEMINI + 'models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(geminiAdvice(res.status, text));
    const j = JSON.parse(text);
    const cand = j.candidates && j.candidates[0];
    const out = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
    if (!out) throw new Error('Geminiから答えが返りませんでした' + (cand && cand.finishReason ? '（' + cand.finishReason + '）' : ''));
    return Core.parseAnswer(out);
  }

  async function geminiModels(key) {
    const res = await fetch(GEMINI + 'models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    const text = await res.text();
    if (!res.ok) throw new Error(geminiAdvice(res.status, text));
    return (JSON.parse(text).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''));
  }

  // ---- Google APIs with the account's token -----------------------------------------------
  async function gfetch(token, url, opt) {
    opt = opt || {};
    const headers = Object.assign({ Authorization: 'Bearer ' + token }, opt.headers || {});
    const res = await fetch(url, Object.assign({}, opt, { headers }));
    if (res.status === 204) return {};
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).error.message;
      } catch (e) {}
      const err = new Error('Google（HTTP ' + res.status + '）：' + msg);
      err.status = res.status;
      if (res.status === 403 && /has not been used|is disabled/i.test(text))
        err.message = 'Google Cloudのプロジェクトで ' + (/drive/i.test(url) ? 'Google Drive API' : 'Google Calendar API') + ' を有効にしてください（設定 →「Google連携の初期設定ガイド」）';
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  async function calendars(token) {
    const j = await gfetch(token, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer');
    return (j.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, color: c.backgroundColor }));
  }

  // The app's folder in My Drive (drive.file: the app sees only what it made).
  async function folder(token, known) {
    if (known) {
      try {
        const f = await gfetch(token, 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(known) + '?fields=id,trashed');
        if (f.id && !f.trashed) return f.id;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    const f = await gfetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Theta Chirashi Hatch', mimeType: 'application/vnd.google-apps.folder' })
    });
    return f.id;
  }

  async function upload(token, folderId, name, blob) {
    const boundary = 'thetachirashi' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [folderId], mimeType: blob.type || 'image/jpeg' });
    const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: ' + (blob.type || 'image/jpeg') + '\r\n\r\n', blob, '\r\n--' + boundary + '--'], {
      type: 'multipart/related; boundary=' + boundary
    });
    return gfetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name,mimeType,iconLink', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body
    });
  }

  async function fileInfo(token, id) {
    try {
      const f = await gfetch(token, 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,webViewLink,name,mimeType,iconLink,trashed');
      return f.trashed ? null : f;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function putEvent(token, calendarId, eventId, body) {
    const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events';
    if (eventId) {
      try {
        return await gfetch(token, base + '/' + encodeURIComponent(eventId) + '?supportsAttachments=true', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
      }
    }
    return gfetch(token, base + '?supportsAttachments=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function deleteEvent(token, calendarId, eventId) {
    try {
      await gfetch(token, 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events/' + encodeURIComponent(eventId), { method: 'DELETE' });
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;
    }
  }

  window.G = { geminiRead, geminiModels, calendars, folder, upload, fileInfo, putEvent, deleteEvent };
})();

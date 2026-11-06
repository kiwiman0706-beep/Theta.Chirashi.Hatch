// Theta Chirashi Hatch — the screen. Records live in one JSON file on the phone (Java bridge),
// pictures in media/. Reading uses Gemini, QR codes ML Kit, registering Google Calendar + Drive.
(function () {
  'use strict';
  const N = window.AndroidNative;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const KIND = { flyer: 'チラシ', map: '地図', card: '名刺', other: 'その他' };
  const FORMAT = { onsite: '会場', online: 'Web', hybrid: '会場＋Web' };

  // ---- bridge --------------------------------------------------------------------------------
  let seq = 0;
  const waits = {};
  window.AndroidReply = (id, data) => {
    const w = waits[id];
    delete waits[id];
    if (!w) return;
    if (data && data.error) w.reject(new Error(data.error));
    else w.resolve(data || {});
  };
  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = 'c' + ++seq;
      waits[id] = { resolve, reject };
      N.call(method, JSON.stringify(args || {}), id);
    });
  }

  // ---- data ----------------------------------------------------------------------------------
  let db = { version: 1, records: [], settings: {} };
  function load() {
    try {
      const t = N.loadData();
      if (t) db = Object.assign({ version: 1, records: [], settings: {} }, JSON.parse(t));
    } catch (e) {
      toast('データを読み込めませんでした：' + e.message);
    }
    db.settings = Object.assign({ model: 'gemini-2.5-flash', calendarId: 'primary', calendarName: '' }, db.settings);
  }
  function save() {
    const err = N.saveData(JSON.stringify(db));
    if (err) toast('保存できませんでした：' + err);
  }
  function rec(id) {
    return db.records.find((r) => r.id === id);
  }
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function today() {
    return Core.ymd(new Date());
  }

  // ---- helpers -------------------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function linkify(s) {
    return esc(s).replace(/https?:\/\/[^\s<>"']+/g, (u) => '<a href="#" data-url="' + u + '">' + u + '</a>');
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), Math.min(9000, 2500 + msg.length * 60));
  }
  window.toast = toast;
  function busy(text) {
    $('#busy').hidden = !text;
    if (text) $('#busy-text').textContent = text;
  }
  function openUrl(url) {
    call('openUrl', { url }).catch(() => {});
  }
  function copy(text, what) {
    call('copyText', { text }).then(() => toast((what || '') + 'コピーしました'));
  }
  function isPast(r) {
    const last = r.endDate || r.date;
    return !!last && last < today();
  }

  // ---- state & navigation --------------------------------------------------------------------
  const ui = { tab: 'list', filter: 'upcoming', q: '', month: null, day: today(), stack: [] };

  function push(layer) {
    ui.stack.push(layer);
    renderLayer();
  }
  function pop() {
    ui.stack.pop();
    renderLayer();
    render();
  }
  window.handleBack = function () {
    const dlg = $('.dialog-back');
    if (dlg && !dlg.hidden) {
      closeDialog();
      return true;
    }
    if (ui.stack.length) {
      pop();
      return true;
    }
    if (ui.tab !== 'list') {
      setTab('list');
      return true;
    }
    return false;
  };
  function setTab(t) {
    ui.tab = t;
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
  }

  // ---- list ----------------------------------------------------------------------------------
  function dateBox(r) {
    const d = Core.parseYmd(r.date);
    if (!d) return '<div class="datebox none">日付<br>未定</div>';
    return '<div class="datebox' + (isPast(r) ? ' past' : '') + '"><span class="m">' + (d.getMonth() + 1) + '月</span><span class="d">' + d.getDate() + '</span><span class="w">' + Core.WEEK[d.getDay()] + '</span></div>';
  }
  function badges(r) {
    const b = [];
    if (r.status === 'reading') b.push('<span class="badge warn">読み取り中</span>');
    if (r.status === 'error') b.push('<span class="badge err">読み取り失敗</span>');
    if (r.format !== 'onsite' && r.status === 'ready') b.push('<span class="badge web">' + FORMAT[r.format] + '</span>');
    if (r.calendar && r.calendar.via === 'api') b.push('<span class="badge ok">カレンダー登録済</span>');
    else if (r.calendar && r.calendar.via === 'intent') b.push('<span class="badge ok">カレンダーアプリへ送信済</span>');
    else if (r.status === 'ready' && r.date && !isPast(r)) b.push('<span class="badge warn">未登録</span>');
    if (r.cards && r.cards.length) b.push('<span class="badge">名刺 ' + r.cards.length + '</span>');
    if (r.category && r.category !== 'その他') b.push('<span class="badge">' + esc(r.category) + '</span>');
    return '<div class="badges">' + b.join('') + '</div>';
  }
  function item(r) {
    const where = r.format === 'online' ? 'Web開催' + (r.online && r.online.platform ? '（' + r.online.platform + '）' : '') : [r.venue, r.room].filter(Boolean).join(' ');
    const first = r.pages && r.pages[0];
    return (
      '<button class="item" data-open="' + r.id + '">' + dateBox(r) +
      '<div class="body"><div class="t">' + esc(r.title || '（題名なし）') + '</div>' +
      '<div class="s">' + esc([Core.timeLabel(r), where].filter(Boolean).join('　')) + '</div>' +
      (r.organizer ? '<div class="s">' + esc(r.organizer) + '</div>' : '') + badges(r) + '</div>' +
      (first ? '<img class="thumb" loading="lazy" src="media/' + esc(first.name) + '" alt="">' : '') + '</button>'
    );
  }
  function sorted(list) {
    return list.slice().sort((a, b) => ((a.date || '9999') + (a.start || '')).localeCompare((b.date || '9999') + (b.start || '')));
  }
  function renderList() {
    const all = db.records.filter((r) => Core.matches(r, ui.q));
    let list;
    if (ui.filter === 'upcoming') list = sorted(all.filter((r) => !isPast(r)));
    else if (ui.filter === 'past') list = sorted(all.filter(isPast)).reverse();
    else if (ui.filter === 'unreg') list = sorted(all.filter((r) => !r.calendar && r.date && !isPast(r)));
    else if (ui.filter === 'web') list = sorted(all.filter((r) => r.format !== 'onsite'));
    else list = sorted(all).reverse();
    const chips = [
      ['upcoming', 'これから'],
      ['unreg', 'カレンダー未登録'],
      ['web', 'Web参加'],
      ['past', '過去'],
      ['all', 'すべて']
    ];
    let html =
      '<div class="toolbar"><input class="search" id="q" type="search" placeholder="検索（会の名前・会場・先生・製品・会社…）" value="' + esc(ui.q) + '">' +
      '<div class="chips">' + chips.map(([k, l]) => '<button class="chip' + (ui.filter === k ? ' on' : '') + '" data-filter="' + k + '">' + l + '</button>').join('') + '</div></div>';
    if (!db.records.length) {
      html += '<div class="empty"><div class="big">📄</div><p>まだチラシがありません。<br>右下の「チラシをスキャン」から、勉強会やイベントのチラシを撮影してください。<br>地図の面や、一緒にもらった名刺も同時にスキャンできます。</p>' +
        (N.secretGet() ? '' : '<p><button class="btn primary" data-act="settings">最初に Gemini APIキーを設定</button></p>') + '</div>';
    } else if (!list.length) {
      html += '<div class="empty">該当するチラシはありません</div>';
    } else {
      let last = '';
      list.forEach((r) => {
        const d = Core.parseYmd(r.date);
        const g = d ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' : '日付未定';
        if (g !== last) {
          html += '<div class="group">' + g + '</div>';
          last = g;
        }
        html += item(r);
      });
    }
    $('#main').innerHTML = html;
    const q = $('#q');
    q.addEventListener('input', () => {
      ui.q = q.value;
      const pos = q.selectionStart;
      renderList();
      const nq = $('#q');
      nq.focus();
      try {
        nq.setSelectionRange(pos, pos);
      } catch (e) {}
    });
  }

  // ---- calendar view ---------------------------------------------------------------------------
  function renderCal() {
    const base = ui.month ? Core.parseYmd(ui.month + '-01') : new Date();
    const y = base.getFullYear(), m = base.getMonth();
    ui.month = y + '-' + Core.pad(m + 1);
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const byDay = {};
    db.records.forEach((r) => {
      const d0 = Core.parseYmd(r.date);
      if (!d0) return;
      const d1 = Core.parseYmd(r.endDate) || d0;
      for (let d = new Date(d0); d <= d1 && d - d0 < 40 * 864e5; d.setDate(d.getDate() + 1)) (byDay[Core.ymd(d)] = byDay[Core.ymd(d)] || []).push(r);
    });
    let html =
      '<div class="cal-head"><div class="ym">' + y + '年' + (m + 1) + '月</div><div class="nav">' +
      '<button data-month="-1" aria-label="前の月">‹</button><button data-month="0">今日</button><button data-month="1" aria-label="次の月">›</button></div></div><div class="grid">';
    Core.WEEK.forEach((w, i) => (html += '<div class="wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>'));
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = Core.ymd(d);
      const evs = sorted(byDay[key] || []);
      const cls = ['cell', d.getMonth() !== m ? 'out' : '', d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '', key === today() ? 'today' : '', key === ui.day ? 'sel' : ''].join(' ');
      html += '<button class="' + cls + '" data-day="' + key + '"><span class="n">' + d.getDate() + '</span>';
      evs.slice(0, 2).forEach((r) => (html += '<span class="ev' + (r.format === 'online' ? ' web' : '') + (isPast(r) ? ' past' : '') + '">' + esc(r.title) + '</span>'));
      if (evs.length > 2) html += '<span class="more">+' + (evs.length - 2) + '</span>';
      html += '</button>';
      if (i === 34 && d.getMonth() !== m) break;
    }
    html += '</div>';
    const dayList = sorted(byDay[ui.day] || []);
    html += '<div class="day-title">' + Core.dateLabel(ui.day) + '</div>';
    html += dayList.length ? dayList.map(item).join('') : '<div class="hint">この日の予定はありません</div>';
    const undated = db.records.filter((r) => !r.date);
    if (undated.length) html += '<div class="group">日付未定</div>' + undated.map(item).join('');
    $('#main').innerHTML = html;
  }

  function render() {
    if (ui.tab === 'cal') renderCal();
    else renderList();
  }

  // ---- layers --------------------------------------------------------------------------------
  function renderLayer() {
    const top = ui.stack[ui.stack.length - 1];
    const el = $('#layer');
    if (!top) {
      el.innerHTML = '';
      return;
    }
    const keepScroll = el.firstElementChild && el.firstElementChild.dataset.key === top.type + (top.id || '') ? el.firstElementChild.scrollTop : 0;
    if (top.type === 'detail') el.innerHTML = detailHtml(rec(top.id));
    else if (top.type === 'edit') el.innerHTML = editHtml(top.draft);
    else if (top.type === 'settings') el.innerHTML = settingsHtml();
    else if (top.type === 'guide') el.innerHTML = guideHtml();
    else if (top.type === 'viewer') el.innerHTML = viewerHtml(top);
    if (el.firstElementChild) {
      el.firstElementChild.dataset.key = top.type + (top.id || '');
      el.firstElementChild.scrollTop = keepScroll;
    }
    if (top.type === 'detail') bindMemo(top.id);
  }
  function head(title, actions) {
    return '<div class="sheet-head"><button class="icon-btn" data-act="back" aria-label="戻る"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg></button><div class="ttl">' + esc(title) + '</div>' + (actions || '') + '</div>';
  }
  function row(k, v, html) {
    if (!v) return '';
    return '<div class="row"><div class="k">' + esc(k) + '</div><div class="v">' + (html ? v : linkify(v)) + '</div></div>';
  }

  function detailHtml(r) {
    if (!r) return '';
    let h = '<div class="sheet">' + head(r.title || 'チラシ', '<button class="act" data-act="edit">編集</button>') + '<div class="sheet-body">';
    if (r.pages && r.pages.length)
      h += '<div class="pages">' + r.pages.map((p, i) => '<button data-view="' + i + '"><img src="media/' + esc(p.name) + '" alt="ページ' + (i + 1) + '"><span class="kind">' + (KIND[p.kind] || '') + '</span></button>').join('') + '</div>';
    if (r.status === 'reading') h += '<div class="status warn">読み取り中です…</div>';
    if (r.status === 'error') h += '<div class="status err">読み取りに失敗しました：' + esc(r.error) + '<div class="btns"><button class="btn primary" data-act="reread">もう一度読み取る</button><button class="btn" data-act="settings">設定</button></div></div>';
    h += '<h1 class="title">' + esc(r.title || '（題名なし）') + '</h1>';
    if (r.subtitle) h += '<p class="subtitle">' + esc(r.subtitle) + '</p>';
    h += badges(r);
    h += '<div class="when"><div><div class="d">' + Core.dateLabel(r.date, true) + (r.endDate ? '〜' + Core.dateLabel(r.endDate) : '') + '</div><div class="t">' + esc(Core.timeLabel(r) || '時刻未定') + '　' + FORMAT[r.format] + '</div></div></div>';

    // calendar
    const c = r.calendar;
    if (c && c.via === 'api')
      h += '<div class="status ok">Googleカレンダーに登録済み（' + esc(c.calendarName || c.calendarId) + '、' + esc((c.at || '').slice(0, 16).replace('T', ' ')) + '）' +
        '<div class="btns"><button class="btn small" data-act="gopen">カレンダーで開く</button><button class="btn small" data-act="register">内容を更新</button><button class="btn small danger" data-act="unregister">登録を取り消す</button></div></div>';
    else if (c && c.via === 'intent')
      h += '<div class="status ok">カレンダーアプリに渡しました（' + esc((c.at || '').slice(0, 16).replace('T', ' ')) + '）<div class="btns"><button class="btn small" data-act="register">Googleカレンダーに画像付きで登録</button><button class="btn small" data-act="intent">もう一度カレンダーアプリへ</button></div></div>';
    else if (r.status === 'ready')
      h += '<div class="btns"><button class="btn primary wide" data-act="register">📅 Googleカレンダーに登録（画像付き）</button><button class="btn wide" data-act="intent">カレンダーアプリで登録（設定なしで使える・画像なし）</button></div>';

    // web
    const on = r.online || {};
    if (on.url || on.meetingId || r.format !== 'onsite') {
      h += '<div class="sec"><h2>Web参加' + (on.platform ? '（' + esc(on.platform) + '）' : '') + '</h2>';
      if (on.url) h += '<div class="btns"><button class="btn navy" data-url="' + esc(on.url) + '">' + esc(on.platform || 'Web') + 'を開く</button><button class="btn small" data-copy="' + esc(on.url) + '">URLをコピー</button></div>';
      h += row('URL', on.url) + row('ミーティングID', on.meetingId) + row('パスコード', on.passcode) + row('注意', on.note);
      if (on.meetingId) h += '<div class="btns"><button class="btn small" data-copy="' + esc(on.meetingId) + '">IDをコピー</button>' + (on.passcode ? '<button class="btn small" data-copy="' + esc(on.passcode) + '">パスコードをコピー</button>' : '') + '</div>';
      if (!on.url && !on.meetingId) h += '<div class="hint">参加URLは読み取れませんでした（後日メールで届く場合は「編集」で追加できます）</div>';
      h += '</div>';
    }
    // venue
    if (r.format !== 'online' && (r.venue || r.address)) {
      h += '<div class="sec"><h2>会場</h2>' + row('会場', [r.venue, r.room].filter(Boolean).join(' ')) + row('住所', r.address) +
        (r.phone ? row('電話', '<a href="#" data-url="tel:' + esc(r.phone.replace(/[^\d+]/g, '')) + '">' + esc(r.phone) + '</a>', true) : '') + row('アクセス', r.access) +
        '<div class="btns"><button class="btn small" data-act="map">地図で見る</button><button class="btn small" data-act="route">経路を調べる</button></div></div>';
    }
    if (r.summary) h += '<div class="sec"><h2>概要</h2><div class="v" style="white-space:pre-wrap">' + esc(r.summary) + '</div></div>';
    if (r.program && r.program.length) {
      h += '<div class="sec"><h2>プログラム</h2>';
      r.program.forEach((p) => {
        h += '<div class="prog">' + (p.time ? '<div class="pt">' + esc(p.time) + '</div>' : '') + '<div>' + (p.kind ? '<span class="pk">' + esc(p.kind) + '</span>' : '') + '<span class="ptitle">' + esc(p.title) + '</span></div>';
        (p.people || []).forEach((x) => (h += '<div class="pp"><span class="role">' + esc(x.role) + '</span>　<b>' + esc(x.name) + '</b> 先生' + (x.affiliation ? '<div class="hint">' + esc(x.affiliation) + '</div>' : '') + '</div>'));
        h += '</div>';
      });
      h += '</div>';
    }
    const reg = r.registration || {};
    const more = row('事前申込', reg.required) + row('申込締切', reg.deadline ? Core.dateLabel(reg.deadline, true) : '') + row('申込方法', reg.method) + row('申込URL', reg.url) + row('問い合わせ', reg.contact) + row('参加費', r.fee) + row('単位', r.credits) +
      row('主催', r.organizer) + row('共催', r.cosponsor) + row('製品', r.product) + row('種別', r.category) + row('資材コード', r.code);
    if (more) h += '<div class="sec"><h2>詳細</h2>' + more + '</div>';
    if (r.notes && r.notes.length) h += '<div class="sec"><h2>注意・備考</h2>' + r.notes.map((n) => '<div class="row"><div class="v">・' + linkify(n) + '</div></div>').join('') + '</div>';
    if (r.cards && r.cards.length) {
      h += '<div class="sec"><h2>名刺（' + r.cards.length + '）</h2>';
      r.cards.forEach((cd, i) => {
        h += '<div class="cardp"><div class="nm">' + esc(cd.name || '（氏名なし）') + (cd.kana ? ' <span class="hint">' + esc(cd.kana) + '</span>' : '') + '</div><div class="co">' + esc([cd.company, cd.department, cd.title].filter(Boolean).join(' ')) + '</div>' +
          row('携帯', cd.mobile) + row('電話', cd.phone) + row('メール', cd.email) +
          '<div class="btns"><button class="btn small" data-contact="' + i + '">連絡先に追加</button>' + (cd.mobile || cd.phone ? '<button class="btn small" data-url="tel:' + esc((cd.mobile || cd.phone).replace(/[^\d+]/g, '')) + '">電話</button>' : '') + (cd.email ? '<button class="btn small" data-url="mailto:' + esc(cd.email) + '">メール</button>' : '') + '</div></div>';
      });
      h += '</div>';
    }
    if (r.qr && r.qr.length) h += '<div class="sec"><h2>QRコード</h2>' + r.qr.map((q) => '<div class="row"><div class="v">' + linkify(q.raw) + '</div></div>').join('') + '</div>';
    h += '<div class="sec"><h2>メモ</h2><textarea class="memo" id="memo" placeholder="参加の予定、持ち物、感想など（カレンダーの説明にも入ります）">' + esc(r.memo || '') + '</textarea></div>';
    h += '<div class="btns"><button class="btn" data-act="share">画像と内容を共有</button><button class="btn" data-act="copytext">内容をコピー</button><button class="btn" data-act="md">Markdownで保存</button>' +
      (r.status !== 'reading' ? '<button class="btn" data-act="reread">読み取り直す</button>' : '') + '<button class="btn" data-act="addpages">ページを追加</button><button class="btn danger" data-act="delete">削除</button></div>';
    h += '</div></div>';
    return h;
  }
  function bindMemo(id) {
    const m = $('#memo');
    if (!m) return;
    m.addEventListener('change', () => {
      const r = rec(id);
      r.memo = m.value;
      r.updatedAt = new Date().toISOString();
      save();
      if (r.calendar && r.calendar.via === 'api') toast('メモを保存しました。カレンダーにも反映するには「内容を更新」を押してください');
    });
  }

  function viewerHtml(v) {
    const r = rec(v.id);
    const p = r.pages[v.page];
    return '<div class="viewer"><div class="vhead"><button data-act="back">閉じる</button><span>' + (v.page + 1) + ' / ' + r.pages.length + '　' + (KIND[p.kind] || '') + '</span><span><button data-vmove="-1">‹</button> <button data-vmove="1">›</button></span></div>' +
      '<div class="vbody' + (v.zoom ? ' zoom' : '') + '" data-act="zoom"><img src="media/' + esc(p.name) + '" alt=""></div></div>';
  }

  // ---- edit ------------------------------------------------------------------------------------
  function field(label, key, value, type, extra) {
    return '<div class="field"><label>' + label + '</label>' +
      (type === 'textarea' ? '<textarea data-f="' + key + '"' + (extra || '') + '>' + esc(value) + '</textarea>' : '<input data-f="' + key + '" type="' + (type || 'text') + '" value="' + esc(value) + '"' + (extra || '') + '>') + '</div>';
  }
  function editHtml(d) {
    const on = d.online || {};
    const reg = d.registration || {};
    const cats = ['勉強会', '講演会', '研修会', '学会', 'セミナー', '説明会', 'イベント', '名刺', 'その他'];
    return '<div class="sheet">' + head('編集', '<button class="act" data-act="saveedit">保存</button>') + '<div class="sheet-body">' +
      field('会の名前', 'title', d.title) + field('副題・テーマ', 'subtitle', d.subtitle) +
      '<div class="field"><label>種別</label><select data-f="category">' + cats.map((c) => '<option' + (c === d.category ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
      '<div class="two">' + field('日付', 'date', d.date, 'date') + field('終了日（複数日）', 'endDate', d.endDate, 'date') + '</div>' +
      '<div class="two">' + field('開始', 'start', d.start, 'time') + field('終了', 'end', d.end, 'time') + '</div>' +
      '<div class="field"><label>形式</label><select data-f="format">' + Object.keys(FORMAT).map((k) => '<option value="' + k + '"' + (k === d.format ? ' selected' : '') + '>' + FORMAT[k] + '</option>').join('') + '</select></div>' +
      '<div class="two">' + field('会場', 'venue', d.venue) + field('階・部屋', 'room', d.room) + '</div>' +
      field('住所', 'address', d.address) + '<div class="two">' + field('会場の電話', 'phone', d.phone, 'tel') + field('アクセス', 'access', d.access) + '</div>' +
      '<div class="two">' + field('Web：サービス', 'online.platform', on.platform) + field('Web：参加URL', 'online.url', on.url, 'url') + '</div>' +
      '<div class="two">' + field('ミーティングID', 'online.meetingId', on.meetingId) + field('パスコード', 'online.passcode', on.passcode) + '</div>' +
      field('主催', 'organizer', d.organizer) + '<div class="two">' + field('共催・後援', 'cosponsor', d.cosponsor) + field('製品', 'product', d.product) + '</div>' +
      '<div class="two">' + field('事前申込', 'registration.required', reg.required) + field('申込締切', 'registration.deadline', reg.deadline, 'date') + '</div>' +
      field('申込URL', 'registration.url', reg.url, 'url') + field('問い合わせ', 'registration.contact', reg.contact) +
      '<div class="two">' + field('参加費', 'fee', d.fee) + field('単位', 'credits', d.credits) + '</div>' +
      field('概要', 'summary', d.summary, 'textarea') + field('注意・備考（1行に1つ）', 'notes', (d.notes || []).join('\n'), 'textarea') +
      field('メモ', 'memo', d.memo, 'textarea') +
      (d.cards && d.cards.length ? '<div class="field"><label>名刺</label>' + d.cards.map((c, i) => '<div class="row"><div class="v">' + esc(c.name + ' ' + c.company) + '</div><button class="btn small danger" data-dropcard="' + i + '">外す</button></div>').join('') + '</div>' : '') +
      '<p class="hint">プログラムは読み取り結果のまま残ります。直したいときは「読み取り直す」を使うか、メモに書いてください。</p>' +
      '</div></div>';
  }
  function collectEdit(d) {
    $$('[data-f]').forEach((el) => {
      const k = el.dataset.f;
      let v = el.value.trim();
      if (k === 'notes') v = v.split('\n').map((s) => s.trim()).filter(Boolean);
      const parts = k.split('.');
      if (parts.length === 2) {
        d[parts[0]] = d[parts[0]] || {};
        d[parts[0]][parts[1]] = v;
      } else d[k] = v;
    });
    if (d.endDate && d.endDate <= d.date) d.endDate = '';
    if (d.online && d.online.url && d.format === 'onsite') d.format = d.venue ? 'hybrid' : 'online';
    if (d.online && d.online.url && !d.online.platform) d.online.platform = Core.platformOf(d.online.url);
    return d;
  }

  // ---- settings ------------------------------------------------------------------------------
  function info() {
    try {
      return JSON.parse(N.info());
    } catch (e) {
      return {};
    }
  }
  function settingsHtml() {
    const s = db.settings;
    const key = N.secretGet();
    const inf = info();
    return '<div class="sheet">' + head('設定') + '<div class="sheet-body">' +
      '<div class="sec"><h2>Gemini（チラシの読み取り）</h2>' +
      '<div class="field"><label>Gemini APIキー</label><input id="s-key" type="password" autocomplete="off" value="' + esc(key) + '" placeholder="AIza…"></div>' +
      '<div class="btns"><button class="btn small" data-act="savekey">キーを保存</button><button class="btn small" data-act="showkey">表示</button><button class="btn small" data-url="https://aistudio.google.com/apikey">Google AI Studioでキーを作る</button></div>' +
      '<div class="field"><label>モデル</label><input id="s-model" list="models" value="' + esc(s.model) + '"><datalist id="models">' + (s.models || ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']).map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist></div>' +
      '<div class="btns"><button class="btn small" data-act="savemodel">モデルを保存</button><button class="btn small" data-act="models">使えるモデルの一覧を取得</button></div>' +
      '<p class="hint">Theta Meishi Hatch と同じキーで使えます（キーはこのスマホの中だけに暗号化して保存）。チラシ1件の読み取りは、無料枠の範囲で数回分のリクエストです。</p></div>' +
      '<div class="sec"><h2>Googleカレンダー</h2>' +
      row('アカウント', s.email || '未ログイン') + row('登録先', s.calendarName || (s.calendarId === 'primary' ? 'メインのカレンダー' : s.calendarId)) +
      '<div class="btns"><button class="btn small primary" data-act="login">' + (s.email ? 'アカウントを切り替え' : 'Googleにログイン') + '</button><button class="btn small" data-act="pickcal">登録先のカレンダーを選ぶ</button>' + (s.email ? '<button class="btn small" data-act="logout">ログアウト</button>' : '') + '</div>' +
      '<p class="hint">チラシの画像はGoogleドライブの「Theta Chirashi Hatch」フォルダに保存され、予定に添付されます。ログインには、Google CloudにこのアプリのAndroid用クライアントを1回登録する必要があります。</p>' +
      '<div class="btns"><button class="btn small navy" data-act="guide">Google連携の初期設定ガイド</button></div>' +
      '<p class="hint">設定をしなくても、各チラシの「カレンダーアプリで登録」で、スマホのカレンダーアプリに内容を入れて登録できます（画像の添付はなし）。</p></div>' +
      '<div class="sec"><h2>データ</h2><p class="hint">登録件数：' + db.records.length + '件。データと画像はこのスマホの中に保存されています。</p>' +
      '<div class="btns"><button class="btn small" data-act="backup">バックアップ（JSON）を保存</button></div></div>' +
      '<div class="sec"><h2>このアプリ</h2>' + row('版', inf.version || '') + row('パッケージ', inf.package || '') + '<div class="btns"><button class="btn small" data-url="https://github.com/kiwiman0706-beep/THETA.Chirashi.Hatch">GitHub（説明・新しい版）</button></div></div>' +
      '</div></div>';
  }
  function guideHtml() {
    const inf = info();
    const step = (t, body) => '<li><b>' + t + '</b><div>' + body + '</div></li>';
    const open = (u, l) => '<button class="btn small" data-url="' + u + '">' + l + '</button>';
    return '<div class="sheet">' + head('Google連携の初期設定ガイド') + '<div class="sheet-body"><div class="sec">' +
      '<p>Theta Meishi Hatch などで使っている<b>同じGoogle Cloudプロジェクト</b>に、このアプリ用の「Android」クライアントを追加します（初めてなら1〜3も行います）。</p><ol class="steps">' +
      step('プロジェクトを開く（なければ作る）', open('https://console.cloud.google.com/projectselector2/home/dashboard', 'Google Cloud を開く')) +
      step('APIを有効にする（2つ）', '<div class="btns">' + open('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', 'Google Calendar API') + open('https://console.cloud.google.com/apis/library/drive.googleapis.com', 'Google Drive API') + '</div>') +
      step('OAuth同意画面（Meishiで設定済みなら不要）', 'ユーザーの種類「外部」、公開ステータス「テスト」で、テストユーザーに自分のGmailを追加。<div class="btns">' + open('https://console.cloud.google.com/auth/audience', '対象（テストユーザー）') + '</div>') +
      step('Android用のOAuthクライアントを作る', '「クライアントを作成」→ 種類「Android」に、次の2つを貼り付けます。<div class="field"><label>パッケージ名</label><div class="mono">' + esc(inf.package) + '</div><button class="btn small" data-copy="' + esc(inf.package) + '">コピー</button></div><div class="field"><label>SHA-1 証明書フィンガープリント</label><div class="mono">' + esc(inf.sha1) + '</div><button class="btn small" data-copy="' + esc(inf.sha1) + '">コピー</button></div><div class="btns">' + open('https://console.cloud.google.com/auth/clients/create', 'クライアントを作成') + '</div>') +
      step('アプリでログイン', '数分待ってから、設定の「Googleにログイン」でアカウントを選び、カレンダーとドライブ（このアプリが作ったファイルだけ）へのアクセスを許可します。<div class="btns"><button class="btn small primary" data-act="login">Googleにログイン</button></div>') +
      '</ol><p class="hint">クライアントIDをアプリに入力する必要はありません。「許可を中止しました」と出るときは、たいてい4のパッケージ名・SHA-1の違いか、3のテストユーザー未登録です。</p></div></div></div>';
  }

  // ---- dialogs --------------------------------------------------------------------------------
  function dialog(html) {
    let back = $('.dialog-back');
    if (!back) {
      back = document.createElement('div');
      back.className = 'dialog-back';
      document.body.appendChild(back);
      back.addEventListener('click', (e) => {
        if (e.target === back) closeDialog();
      });
    }
    back.innerHTML = '<div class="dialog">' + html + '</div>';
    back.hidden = false;
    return back;
  }
  function closeDialog() {
    const b = $('.dialog-back');
    if (b) b.hidden = true;
  }
  function confirmBox(title, text, ok) {
    return new Promise((resolve) => {
      const b = dialog('<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="btns"><button class="btn primary" data-yes>' + esc(ok || 'OK') + '</button><button class="btn" data-no>キャンセル</button></div>');
      $('[data-yes]', b).onclick = () => (closeDialog(), resolve(true));
      $('[data-no]', b).onclick = () => (closeDialog(), resolve(false));
    });
  }

  // ---- scanning & reading ------------------------------------------------------------------------
  async function scan(addTo) {
    try {
      const r = await call('scan', { pages: 20 });
      if (r.unavailable) {
        toast('このスマホではスキャナーを使えないため、写真から選んでください');
        pick(addTo);
        return;
      }
      if (!r.files || !r.files.length) return;
      await takeIn(r.files.map((f) => f.name), addTo);
    } catch (e) {
      toast(e.message);
    }
  }
  let pickTarget = null;
  function pick(addTo) {
    pickTarget = addTo || null;
    const inp = $('#file-pick');
    inp.value = '';
    inp.click();
  }
  // A picture from the gallery → a JPEG in media/ (no larger than needed).
  function fileToMedia(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 3000;
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const name = newId() + '.jpg';
        const err = N.writeMedia(name, c.toDataURL('image/jpeg', 0.9).split(',')[1]);
        if (err) reject(new Error(err));
        else resolve(name);
      };
      img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('画像を開けませんでした')));
      img.src = url;
    });
  }
  async function takeIn(incomingNames, addTo) {
    const names = [];
    for (const n of incomingNames) {
      const err = N.keep(n);
      if (err) {
        toast('画像を保存できませんでした：' + err);
        return;
      }
      names.push(n);
    }
    await takeMedia(names, addTo);
  }
  async function takeMedia(names, addTo) {
    let r = addTo ? rec(addTo) : null;
    if (r) {
      names.forEach((n) => r.pages.push({ name: n, kind: 'flyer' }));
    } else {
      r = { id: newId(), createdAt: new Date().toISOString(), status: 'reading', title: '読み取り中…', format: 'onsite', pages: names.map((n) => ({ name: n, kind: 'flyer' })), cards: [], qr: [], online: {}, registration: {}, program: [], notes: [] };
      db.records.push(r);
    }
    save();
    ui.stack = [{ type: 'detail', id: r.id }];
    renderLayer();
    render();
    await readRecord(r.id);
  }
  async function imageData(name) {
    const img = new Image();
    img.src = 'media/' + name;
    await img.decode();
    const max = 2000;
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
  }
  async function readRecord(id) {
    let r = rec(id);
    if (!r) return;
    const key = N.secretGet();
    if (!key) {
      r.status = 'error';
      r.error = 'Gemini APIキーが未設定です。設定でキーを入れてから「もう一度読み取る」を押してください';
      save();
      renderLayer();
      render();
      return;
    }
    r.status = 'reading';
    renderLayer();
    try {
      const names = r.pages.map((p) => p.name);
      busy('QRコードを探しています…');
      const qr = [];
      for (let i = 0; i < names.length; i++) {
        try {
          const res = await call('qr', { path: 'media/' + names[i] });
          (res.codes || []).forEach((c) => qr.push({ page: i + 1, raw: c.raw, url: c.url }));
        } catch (e) {
          /* QR is a bonus */
        }
      }
      busy('画像を準備しています…');
      const images = [];
      for (const n of names) images.push(await imageData(n));
      busy('Geminiでチラシを読み取っています…（' + names.length + 'ページ、20〜60秒）');
      const answer = await G.geminiRead(key, db.settings.model || 'gemini-2.5-flash', Core.prompt(today(), qr), images);
      const out = Core.toRecords(answer, names, qr, new Date());
      r = rec(id);
      const keep = { id: r.id, createdAt: r.createdAt, memo: r.memo || '', calendar: r.calendar };
      // Pages keep their Drive copies when read again.
      const drive = {};
      r.pages.forEach((p) => p.driveId && (drive[p.name] = { driveId: p.driveId, driveLink: p.driveLink }));
      const now = new Date().toISOString();
      out.forEach((o, i) => {
        o.pages.forEach((p) => Object.assign(p, drive[p.name] || {}));
        if (i === 0) {
          Object.keys(r).forEach((k) => delete r[k]);
          Object.assign(r, o, keep, { status: 'ready', updatedAt: now });
        } else db.records.push(Object.assign(o, { id: newId(), createdAt: now, updatedAt: now, status: 'ready', memo: '' }));
      });
      save();
      busy(null);
      toast(out.length > 1 ? out.length + '件の会を読み取りました。内容を確認してください' : '読み取りました。内容を確認して、カレンダーに登録してください');
    } catch (e) {
      busy(null);
      r = rec(id);
      r.status = 'error';
      r.error = e.message;
      save();
    }
    renderLayer();
    render();
  }

  // ---- Google ----------------------------------------------------------------------------------
  async function token(interactive, chooser) {
    const s = db.settings;
    const r = await call('token', { email: chooser ? '' : s.email || '', interactive: !!interactive, chooser: !!chooser });
    if (r.needLogin) throw new Error('Googleにログインしてください（設定 →「Googleにログイン」）');
    if (r.email && r.email !== s.email) {
      s.email = r.email;
      save();
    }
    return r.token;
  }
  async function login() {
    try {
      busy('Googleに接続しています…');
      await token(true, true);
      busy(null);
      toast('ログインしました：' + db.settings.email);
      renderLayer();
    } catch (e) {
      busy(null);
      toast(e.message);
      if (/クライアント|中止|SHA-1|connect|10:/i.test(e.message)) push({ type: 'guide' });
    }
  }
  async function pickCalendar() {
    try {
      busy('カレンダーの一覧を取得しています…');
      const t = await token(true);
      const list = await G.calendars(t);
      busy(null);
      const b = dialog('<h3>登録先のカレンダー</h3>' + list.map((c, i) => '<button class="choice" data-i="' + i + '"><b>' + esc(c.name) + (c.primary ? '（メイン）' : '') + '</b><span>' + esc(c.id) + '</span></button>').join(''));
      $$('[data-i]', b).forEach((el) =>
        (el.onclick = () => {
          const c = list[+el.dataset.i];
          db.settings.calendarId = c.primary ? 'primary' : c.id;
          db.settings.calendarName = c.name;
          save();
          closeDialog();
          renderLayer();
        })
      );
    } catch (e) {
      busy(null);
      toast(e.message);
    }
  }
  async function register(id) {
    const r = rec(id);
    if (!r.date) {
      toast('日付がありません。「編集」で日付を入れてください');
      return;
    }
    try {
      busy('Googleに接続しています…');
      const t = await token(true, !db.settings.email);
      const s = db.settings;
      busy('チラシの画像をGoogleドライブに保存しています…');
      s.folderId = await G.folder(t, s.folderId);
      save();
      const attachments = [], images = [];
      for (let i = 0; i < r.pages.length; i++) {
        const p = r.pages[i];
        let f = p.driveId ? await G.fileInfo(t, p.driveId) : null;
        if (!f) {
          const blob = await (await fetch('media/' + p.name)).blob();
          const fname = (r.date || '') + ' ' + (r.title || 'チラシ').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60) + ' ' + (i + 1) + '（' + (KIND[p.kind] || '') + '）.jpg';
          f = await G.upload(t, s.folderId, fname, blob.type ? blob : new Blob([blob], { type: 'image/jpeg' }));
          p.driveId = f.id;
          p.driveLink = f.webViewLink;
          save();
        }
        const title = (i + 1) + '枚目（' + (KIND[p.kind] || '画像') + '）';
        attachments.push({ fileUrl: f.webViewLink, fileId: f.id, title: f.name || title, mimeType: f.mimeType || 'image/jpeg', iconLink: f.iconLink });
        images.push({ title, url: f.webViewLink });
      }
      busy('Googleカレンダーに登録しています…');
      const calId = s.calendarId || 'primary';
      const same = r.calendar && r.calendar.via === 'api' && r.calendar.calendarId === calId;
      const ev = await G.putEvent(t, calId, same ? r.calendar.eventId : null, Core.calendarBody(r, images, attachments.slice(0, 25)));
      r.calendar = { via: 'api', eventId: ev.id, calendarId: calId, calendarName: s.calendarName || (calId === 'primary' ? 'メインのカレンダー' : calId), htmlLink: ev.htmlLink, at: new Date().toISOString() };
      r.updatedAt = r.calendar.at;
      save();
      busy(null);
      toast(same ? 'カレンダーの予定を更新しました' : 'Googleカレンダーに登録しました（画像' + images.length + '枚を添付）');
    } catch (e) {
      busy(null);
      toast(e.message);
      if (/クライアント|中止|SHA-1/.test(e.message)) push({ type: 'guide' });
    }
    renderLayer();
    render();
  }
  async function unregister(id) {
    const r = rec(id);
    if (!(await confirmBox('登録を取り消す', 'Googleカレンダーからこの予定を削除します（ドライブの画像は残ります）。', '削除する'))) return;
    try {
      busy('予定を削除しています…');
      const t = await token(true);
      await G.deleteEvent(t, r.calendar.calendarId, r.calendar.eventId);
      delete r.calendar;
      save();
      busy(null);
      toast('カレンダーから削除しました');
    } catch (e) {
      busy(null);
      toast(e.message);
    }
    renderLayer();
    render();
  }
  async function viaIntent(id) {
    const r = rec(id);
    const times = Core.intentTimes(r);
    if (!times) {
      toast('日付がありません。「編集」で日付を入れてください');
      return;
    }
    try {
      await call('calendarIntent', Object.assign({ title: Core.eventTitle(r), location: Core.location(r), description: Core.description(r, []) }, times));
      r.calendar = r.calendar && r.calendar.via === 'api' ? r.calendar : { via: 'intent', at: new Date().toISOString() };
      save();
      renderLayer();
      render();
    } catch (e) {
      toast('カレンダーアプリを開けませんでした：' + e.message);
    }
  }

  async function removeRecord(id) {
    const r = rec(id);
    const reg = r.calendar && r.calendar.via === 'api';
    if (!(await confirmBox('削除', 'このチラシと画像をアプリから削除します。' + (reg ? 'Googleカレンダーの予定は残ります（先に「登録を取り消す」で消せます）。' : ''), '削除する'))) return;
    r.pages.forEach((p) => N.deleteMedia(p.name));
    db.records = db.records.filter((x) => x.id !== id);
    save();
    ui.stack = [];
    renderLayer();
    render();
  }

  // ---- events ------------------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a, [data-act]');
    if (!t) return;
    const top = ui.stack[ui.stack.length - 1];
    const id = top && top.id;
    if (t.dataset.url) {
      e.preventDefault();
      openUrl(t.dataset.url);
      return;
    }
    if (t.dataset.copy) return copy(t.dataset.copy);
    if (t.dataset.tab) return setTab(t.dataset.tab);
    if (t.dataset.filter) {
      ui.filter = t.dataset.filter;
      return render();
    }
    if (t.dataset.open) return push({ type: 'detail', id: t.dataset.open });
    if (t.dataset.day) {
      ui.day = t.dataset.day;
      return renderCal();
    }
    if (t.dataset.month) {
      const d = Core.parseYmd(ui.month + '-01');
      const n = +t.dataset.month;
      const nd = n === 0 ? new Date() : new Date(d.getFullYear(), d.getMonth() + n, 1);
      ui.month = nd.getFullYear() + '-' + Core.pad(nd.getMonth() + 1);
      if (n === 0) ui.day = today();
      return renderCal();
    }
    if (t.dataset.view) return push({ type: 'viewer', id, page: +t.dataset.view });
    if (t.dataset.vmove) {
      const r = rec(id);
      top.page = (top.page + +t.dataset.vmove + r.pages.length) % r.pages.length;
      top.zoom = false;
      return renderLayer();
    }
    if (t.dataset.contact) {
      const c = rec(id).cards[+t.dataset.contact];
      return call('contactIntent', Object.assign({}, c, { note: 'Theta Chirashi Hatch：' + (rec(id).title || '') + '（' + Core.dateLabel(rec(id).date, true) + '）' })).catch((er) => toast(er.message));
    }
    if (t.dataset.dropcard) {
      top.draft.cards.splice(+t.dataset.dropcard, 1);
      collectEdit(top.draft);
      return renderLayer();
    }
    switch (t.dataset.act) {
      case 'back':
        return pop();
      case 'zoom':
        top.zoom = !top.zoom;
        return renderLayer();
      case 'settings':
        return push({ type: 'settings' });
      case 'guide':
        return push({ type: 'guide' });
      case 'edit':
        return push({ type: 'edit', id, draft: JSON.parse(JSON.stringify(rec(id))) });
      case 'saveedit': {
        const d = collectEdit(top.draft);
        const r = rec(id);
        Object.assign(r, d, { updatedAt: new Date().toISOString() });
        save();
        pop();
        if (r.calendar && r.calendar.via === 'api') toast('保存しました。カレンダーに反映するには「内容を更新」を押してください');
        return;
      }
      case 'reread':
        return readRecord(id);
      case 'addpages':
        return scan(id);
      case 'register':
        return register(id);
      case 'unregister':
        return unregister(id);
      case 'intent':
        return viaIntent(id);
      case 'gopen':
        return openUrl(rec(id).calendar.htmlLink);
      case 'map': {
        const r = rec(id);
        return openUrl('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.address || [r.venue, r.room].join(' ')));
      }
      case 'route': {
        const r = rec(id);
        return openUrl('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.address || r.venue));
      }
      case 'share': {
        const r = rec(id);
        return call('share', { names: r.pages.map((p) => p.name), text: Core.eventTitle(r) + '\n' + Core.description(r, []) }).catch((er) => toast(er.message));
      }
      case 'copytext': {
        const r = rec(id);
        return copy(Core.eventTitle(r) + '\n' + Core.description(r, []), '内容を');
      }
      case 'md': {
        const r = rec(id);
        return call('saveFile', { name: (r.date || '') + ' ' + (r.title || 'チラシ').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60) + '.md', type: 'text/markdown', text: Core.markdown(r) })
          .then((x) => x.saved && toast('保存しました'))
          .catch((er) => toast(er.message));
      }
      case 'delete':
        return removeRecord(id);
      case 'savekey':
        N.secretSet($('#s-key').value.trim());
        return toast('APIキーを保存しました');
      case 'showkey': {
        const k = $('#s-key');
        k.type = k.type === 'password' ? 'text' : 'password';
        return;
      }
      case 'savemodel':
        db.settings.model = $('#s-model').value.trim() || 'gemini-2.5-flash';
        save();
        return toast('モデルを保存しました：' + db.settings.model);
      case 'models':
        try {
          busy('モデルの一覧を取得しています…');
          db.settings.models = await G.geminiModels($('#s-key').value.trim() || N.secretGet());
          save();
          busy(null);
          renderLayer();
          return toast(db.settings.models.length + '個のモデルが使えます（モデル欄をタップして選択）');
        } catch (er) {
          busy(null);
          return toast(er.message);
        }
      case 'login':
        return login();
      case 'logout':
        db.settings.email = '';
        save();
        return renderLayer();
      case 'pickcal':
        return pickCalendar();
      case 'backup':
        return call('saveFile', { name: 'theta-chirashi-backup-' + today() + '.json', type: 'application/json', text: JSON.stringify({ app: 'theta-chirashi', exported: new Date().toISOString(), records: db.records }, null, 1) })
          .then((x) => x.saved && toast('バックアップを保存しました（画像は含みません）'))
          .catch((er) => toast(er.message));
    }
  });

  $('#btn-scan').addEventListener('click', () => scan(null));
  $('#btn-pick').addEventListener('click', () => pick(null));
  $('#btn-settings').addEventListener('click', () => push({ type: 'settings' }));
  $('#file-pick').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      busy('画像を取り込んでいます…');
      const names = [];
      for (const f of files) names.push(await fileToMedia(f));
      busy(null);
      await takeMedia(names, pickTarget);
    } catch (er) {
      busy(null);
      toast(er.message);
    }
  });
  window.AndroidShared = (files) => takeIn(files.map((f) => f.name), null);

  // ---- start -------------------------------------------------------------------------------------
  load();
  // A reading cut off by closing the app: offer to read again.
  db.records.forEach((r) => {
    if (r.status === 'reading') {
      r.status = 'error';
      r.error = '読み取りの途中でアプリが閉じられました';
    }
  });
  render();
  if (!N.secretGet() && !db.records.length) setTimeout(() => toast('はじめに、設定（右上の歯車）で Gemini APIキーを入れてください'), 600);
})();

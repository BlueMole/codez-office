/* Codez Office — static viewer for an ntfy.sh feed. Topic comes only from the URL hash.
   All feed text is untrusted: rendered via textContent only. */
(function () {
  'use strict';
  var SHAPES = ['orb', 'cube', 'cone', 'star', 'bean', 'ghost'];
  var STATUSES = ['working', 'idle', 'waiting_user', 'error', 'done'];
  var TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var MAX_NAME = 64, MAX_TEXT = 300;

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || MAX_TEXT) : null; }
  function name(v) { var s = str(v, MAX_NAME); return s && s.trim() ? s.trim() : null; }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function toDate(v) {
    if (typeof v === 'number' && isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
    if (typeof v === 'string' && v) { var d = new Date(v); if (!isNaN(d)) return d; if (/^\d+$/.test(v)) return toDate(Number(v)); }
    return null;
  }
  function fmtTime(d) { return d ? d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

  // ---------- state (only what the feed says) ----------
  var S = {
    roster: [], statuses: {}, looks: {}, teams: null, teamsOrder: [], chat: {},
    routines: {}, usage: null, lastFeed: null, kevin: {}, boards: {}
  };
  var seen = {}; var lastId = null;

  function knownBots() {
    var set = [], add = function (n) { if (n && set.indexOf(n) < 0) set.push(n); };
    S.roster.forEach(add);
    if (S.teams) Object.keys(S.teams).forEach(function (t) { S.teams[t].forEach(add); });
    Object.keys(S.statuses).forEach(add);
    return set;
  }

  // ---------- message handling ----------
  function applyPayload(p, t) {
    if (!isObj(p)) return;
    // status
    if (own(p, 'bot') && own(p, 'status') && !own(p, 'items')) {
      var b = name(p.bot), st = str(p.status, 20);
      if (b && STATUSES.indexOf(st) >= 0) {
        var ts = toDate(p.ts); if (ts) t = ts.getTime();
        var prev = S.statuses[b];
        if (!prev || prev.time <= t) S.statuses[b] = { status: st, step: str(p.step) || '', time: t };
      }
    }
    if (Array.isArray(p.roster)) S.roster = p.roster.map(name).filter(Boolean);
    if (isObj(p.looks)) Object.keys(p.looks).forEach(function (k) {
      var n = name(k), l = p.looks[k]; if (!n || !isObj(l)) return;
      var cur = S.looks[n] || {};
      if (SHAPES.indexOf(l.shape) >= 0) cur.shape = l.shape;
      var c = typeof l.color === 'string' ? l.color.replace(/^#/, '') : '';
      if (/^[0-9a-fA-F]{6}$/.test(c)) cur.color = c;
      S.looks[n] = cur;
    });
    if (isObj(p.teams)) {
      var teams = {};
      Object.keys(p.teams).forEach(function (k) {
        var tn = name(k); if (!tn || !Array.isArray(p.teams[k])) return;
        teams[tn] = p.teams[k].map(name).filter(Boolean);
      });
      S.teams = teams;
    }
    if (Array.isArray(p.teams_order)) S.teamsOrder = p.teams_order.map(name).filter(Boolean);
    if (isObj(p.chat)) Object.keys(p.chat).forEach(function (k) {
      var n = name(k), u = str(p.chat[k], 500);
      if (n && u && /^grokbot:\/\/[^\s"'<>\\]+$/i.test(u)) S.chat[n] = u;
    });
    if (isObj(p.routines)) {
      var rb = name(p.routines.bot);
      if (rb && Array.isArray(p.routines.items)) {
        S.routines[rb] = p.routines.items.filter(isObj).slice(0, 100).map(function (it) {
          return { name: str(it.name, 120) || '(unnamed)', schedule: str(it.schedule, 120) || '', next: toDate(it.next_run), nextRaw: str(it.next_run, 60) || '' };
        });
      }
    }
    if (isObj(p.kevin_items)) {
      var kb = name(p.kevin_items.bot);
      if (kb && Array.isArray(p.kevin_items.items)) {
        S.kevin[kb] = p.kevin_items.items.filter(isObj).slice(0, 100).map(function (it) {
          return { title: str(it.title, MAX_TEXT) || '', since: toDate(it.since) };
        }).filter(function (it) { return it.title.trim(); });
        if (!S.kevin[kb].length) delete S.kevin[kb];
      }
    }
    if (isObj(p.board)) {
      var bt = name(p.board.team);
      if (bt && Array.isArray(p.board.items)) {
        var BS = ['working', 'waiting_kevin', 'blocked', 'next', 'done'];
        S.boards[bt] = {
          team: bt, bot: name(p.board.bot), updated: toDate(p.board.updated) || new Date(t),
          items: p.board.items.filter(isObj).slice(0, 200).map(function (it) {
            var st = it.status === 'open' ? 'next' : it.status;
            return { title: str(it.title, MAX_TEXT) || '', status: BS.indexOf(st) >= 0 ? st : 'next',
              owner: name(it.owner), since: toDate(it.since), due: toDate(it.due) };
          }).filter(function (it) { return it.title.trim(); })
        };
      }
    }
    if (p.type === 'usage') {
      var u = { pct: null, resets: null, resetsRaw: '', bots: {} };
      var tp = Number(p.total_used_pct); if (p.total_used_pct != null && isFinite(tp)) u.pct = Math.max(0, Math.min(100, tp));
      u.resets = toDate(p.resets_at); u.resetsRaw = str(p.resets_at, 60) || '';
      if (isObj(p.bots)) Object.keys(p.bots).forEach(function (k) {
        var n = name(k), v = Number(p.bots[k]); if (n && p.bots[k] != null && isFinite(v)) u.bots[n] = v;
      });
      // also accept bots:[{bot|name, pct|share|used_pct}] and shares:{name: pct}
      if (Array.isArray(p.bots)) p.bots.filter(isObj).forEach(function (o) {
        var n = name(o.bot != null ? o.bot : o.name), raw = o.pct != null ? o.pct : (o.share != null ? o.share : o.used_pct), v = Number(raw);
        if (n && raw != null && isFinite(v)) u.bots[n] = v;
      });
      if (isObj(p.shares)) Object.keys(p.shares).forEach(function (k) {
        var n = name(k), v = Number(p.shares[k]); if (n && p.shares[k] != null && isFinite(v)) u.bots[n] = v;
      });
      S.usage = u;
    }
  }

  function handleEvent(ev) {
    if (!isObj(ev) || ev.event !== 'message' || typeof ev.message !== 'string') return false;
    if (ev.id) { if (seen[ev.id]) return false; seen[ev.id] = 1; lastId = ev.id; }
    var t = typeof ev.time === 'number' ? ev.time * 1000 : Date.now();
    var p; try { p = JSON.parse(ev.message); } catch (e) { return false; }
    applyPayload(p, t);
    if (!S.lastFeed || t > S.lastFeed) S.lastFeed = t;
    return true;
  }

  // ---------- rendering ----------
  var botEls = {}; var layoutSig = ''; var floorEls = {}; var benchRow = null;

  function floorPlan(bots, benched) {
    var floors = [], teamOf = {};
    var teams = S.teams || {};
    var names = Object.keys(teams);
    var order = [];
    if (own(teams, 'HQ')) order.push('HQ');
    S.teamsOrder.forEach(function (t) { if (own(teams, t) && order.indexOf(t) < 0) order.push(t); });
    names.forEach(function (t) { if (order.indexOf(t) < 0) order.push(t); });
    order.forEach(function (t) { teams[t].forEach(function (b) { if (!own(teamOf, b)) teamOf[b] = t; }); });
    order.forEach(function (t) { floors.push({ team: t, members: teams[t].filter(function (b) { return teamOf[b] === t && !benched[b]; }) }); });
    var lobby = bots.filter(function (b) { return !own(teamOf, b) && !benched[b]; });
    if (lobby.length || !floors.length) floors.push({ team: names.length ? 'Lobby' : 'Office', members: lobby, lobby: true });
    return { floors: floors, teamOf: teamOf };
  }

  function makeBot(n) {
    var b = el('div', 'bot');
    b.tabIndex = 0; b.setAttribute('role', 'button');
    b.appendChild(el('div', 'shape'));
    b.appendChild(el('div', 'name', n));
    b.addEventListener('click', function () { openPanel(n); });
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(n); } });
    b._x = 15 + Math.random() * 75; b.style.left = b._x + '%';
    botEls[n] = b; return b;
  }

  function statusOf(n) { return S.statuses[n] ? S.statuses[n].status : 'idle'; }

  function render() {
    var building = $('building');
    var notice = $('notice');
    var bots = knownBots();
    var benched = {};
    if (S.usage) bots.forEach(function (b) { if (own(S.usage.bots, b) && S.usage.bots[b] < 1) benched[b] = true; });
    var plan = floorPlan(bots, benched);
    S._teamOf = plan.teamOf;

    if (!bots.length) { notice.hidden = false; notice.textContent = S.lastFeed ? 'No bots in the feed yet.' : 'Waiting for feed… (nothing in the last 12h yet)'; }
    else notice.hidden = true;

    var sig = JSON.stringify(plan.floors.map(function (f) { return [f.team, f.members]; })) + '|' + Object.keys(benched).sort().join(',');
    if (sig !== layoutSig) {
      layoutSig = sig;
      Object.keys(botEls).forEach(function (k) { if (botEls[k].parentNode) botEls[k].parentNode.removeChild(botEls[k]); });
      building.textContent = ''; floorEls = {};
      if (bots.length) {
        building.appendChild(el('div', 'roof'));
        var total = plan.floors.length;
        plan.floors.forEach(function (f, i) {
          var fl = el('div', 'floor' + (f.team === 'HQ' ? ' hq' : ''));
          var lab = el('div', 'floor-label');
          lab.appendChild(el('span', 'n', (total - i === 1 ? 'G' : 'F' + (total - i))));
          lab.appendChild(document.createTextNode(f.team));
          fl.appendChild(lab);
          for (var w = 0; w < 4; w++) { var win = el('div', 'window'); win.style.left = (22 + w * 20) + '%'; fl.appendChild(win); }
          f.desks = [];
          f.members.forEach(function (m, j) {
            var x = 14 + (j + 0.5) * (82 / Math.max(f.members.length, 1));
            var d = el('div', 'desk'); d.style.left = x + '%'; fl.appendChild(d);
            f.desks.push({ x: x, el: d });
          });
          floorEls[f.team] = { el: fl, f: f };
          building.appendChild(fl);
        });
        var bz = el('div', 'bench-zone');
        bz.appendChild(el('h4', null, '⚽ THE BENCH — under 1% usage'));
        benchRow = el('div', 'bench-row');
        bz.appendChild(benchRow);
        building.appendChild(bz);
      }
    }
    // place / update bots
    bots.forEach(function (n) {
      var b = botEls[n] || makeBot(n);
      var look = S.looks[n] || {};
      var shape = look.shape || 'orb';
      var st = statusOf(n);
      b.className = 'bot ' + st + ' ' + shape;
      b.firstChild.className = 'shape ' + shape;
      b.style.setProperty('--c', '#' + (look.color || '94a3b8'));
      b.setAttribute('aria-label', n + ', ' + st.replace('_', ' '));
      // clear decorations
      Array.prototype.slice.call(b.querySelectorAll('.bubble,.ring,.marker')).forEach(function (x) { b.removeChild(x); });
      var stObj = S.statuses[n];
      if (st === 'working' && stObj && stObj.step) b.appendChild(el('div', 'bubble', stObj.step));
      if (st === 'waiting_user') { b.appendChild(el('div', 'ring')); b.appendChild(el('div', 'bubble q', '?')); }
      if (st === 'error') { b.appendChild(el('div', 'marker', '!')); if (stObj && stObj.step) b.appendChild(el('div', 'bubble', stObj.step)); }
      b._wander = false;
      if (benched[n]) { if (b.parentNode !== benchRow) benchRow.appendChild(b); b.style.left = ''; return; }
      var fe = floorEls[plan.teamOf[n] || (S.teams && Object.keys(S.teams).length ? 'Lobby' : 'Office')];
      if (!fe) return;
      if (b.parentNode !== fe.el) { fe.el.appendChild(b); }
      var idx = fe.f.members.indexOf(n);
      var desk = fe.f.desks[idx];
      if (desk) desk.el.className = 'desk' + (st === 'working' ? ' on' : '');
      if ((st === 'idle' || st === 'done') || !desk) { b._wander = true; b.style.left = b._x + '%'; }
      else { b.style.left = desk.x + '%'; b.classList.add('seated'); }
    });
    if (benchRow && !benchRow.children.length) benchRow.appendChild(el('span', 'empty', 'Nobody on the bench.'));
    else if (benchRow) Array.prototype.slice.call(benchRow.querySelectorAll('.empty')).forEach(function (x) { if (benchRow.children.length > 1) benchRow.removeChild(x); });

    renderTop(); renderRoutines(); renderKevin(); renderBoards(); renderUsageChart();
  }

  function wander() {
    Object.keys(botEls).forEach(function (n) {
      var b = botEls[n];
      if (b._wander && Math.random() < 0.5) { b._x = Math.max(12, Math.min(94, b._x + (Math.random() - 0.5) * 30)); b.style.left = b._x + '%'; }
    });
  }

  function renderTop() {
    var u = S.usage;
    if (u && u.pct != null) {
      $('usageFill').style.width = u.pct + '%';
      $('usageText').textContent = Math.round(u.pct * 10) / 10 + '%' + (u.resets ? ' · resets ' + fmtTime(u.resets) : (u.resetsRaw ? ' · resets ' + u.resetsRaw : ''));
    } else { $('usageFill').style.width = '0'; $('usageText').textContent = '—'; }
    $('feedUpdated').textContent = S.lastFeed ? new Date(S.lastFeed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  }

  function renderRoutines() {
    var list = $('routines'); list.textContent = '';
    var all = [];
    Object.keys(S.routines).forEach(function (b) { S.routines[b].forEach(function (r) { all.push({ bot: b, r: r }); }); });
    all.sort(function (a, c) {
      var x = a.r.next ? a.r.next.getTime() : Infinity, y = c.r.next ? c.r.next.getTime() : Infinity;
      return x - y || a.bot.localeCompare(c.bot);
    });
    if (!all.length) { list.appendChild(el('li', 'empty', 'No routines in feed.')); return; }
    all.forEach(function (o) {
      var li = el('li');
      li.appendChild(el('div', 'rn', o.r.name));
      li.appendChild(el('div', 'rm', (o.r.next ? fmtTime(o.r.next) : (o.r.nextRaw || 'next run unknown')) + ' · ' + o.bot));
      if (o.r.schedule) li.appendChild(el('div', 'rm', o.r.schedule));
      list.appendChild(li);
    });
  }

  // ---------- Kevin open items ----------
  function fmtAge(d) {
    if (!d) return '';
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function miniBot(n) {
    var look = S.looks[n] || {};
    var m = el('span', 'mini shape ' + (look.shape || 'orb'));
    m.style.setProperty('--c', '#' + (look.color || '94a3b8'));
    return m;
  }
  function kevinItems() {
    var out = [];
    Object.keys(S.kevin).forEach(function (b) { S.kevin[b].forEach(function (it) { out.push({ bot: b, title: it.title, since: it.since, tag: null }); }); });
    Object.keys(S.statuses).forEach(function (b) {
      var s = S.statuses[b];
      if (s.status !== 'waiting_user' && s.status !== 'error') return;
      var title = s.step || (s.status === 'error' ? 'Error (no details in feed)' : 'Waiting on you (no details in feed)');
      var dup = (S.kevin[b] || []).some(function (it) { return it.title.trim() === title.trim(); });
      if (!dup) out.push({ bot: b, title: title, since: new Date(s.time), tag: s.status === 'error' ? 'error' : 'waiting' });
    });
    Object.keys(S.boards).forEach(function (tn) {
      var bd = S.boards[tn];
      bd.items.forEach(function (it) {
        if (it.status === 'waiting_kevin') out.push({ bot: bd.bot || tn, title: it.title, since: it.since || bd.updated, tag: null, team: tn, chatBot: bd.bot });
      });
    });
    out.sort(function (a, c) {
      var x = a.since ? a.since.getTime() : Infinity, y = c.since ? c.since.getTime() : Infinity;
      return x - y || a.bot.localeCompare(c.bot);
    });
    return out;
  }
  function renderKevin() {
    var list = $('kevinList'); if (!list) return;
    var items = kevinItems();
    $('kevinCount').textContent = String(items.length);
    list.textContent = '';
    if (!items.length) { list.appendChild(el('li', 'empty', 'Nothing waiting on you.')); return; }
    items.forEach(function (it) {
      var li = el('li', 'ki' + (it.tag ? ' ' + it.tag : ''));
      var who = el('span', 'ki-bot'); who.appendChild(miniBot(it.bot)); who.appendChild(el('span', 'ki-name', it.bot));
      li.appendChild(who);
      var body = el('span', 'ki-body');
      if (it.tag) body.appendChild(el('span', 'tag ' + it.tag, it.tag));
      if (it.team) body.appendChild(el('span', 'tag team', it.team));
      body.appendChild(el('span', 'ki-title', it.title));
      li.appendChild(body);
      var age = el('span', 'ki-age', fmtAge(it.since));
      if (it.since) age.title = it.since.toLocaleString();
      li.appendChild(age);
      var cb = it.team ? it.chatBot : it.bot;
      if (cb && S.chat[cb]) { var a = el('a', 'ki-open', 'Open'); a.href = S.chat[cb]; a.rel = 'noopener noreferrer'; li.appendChild(a); }
      else li.appendChild(el('span', 'ki-open off', '—'));
      list.appendChild(li);
    });
  }

  // ---------- bot usage chart ----------
  var TEAM_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c', '#a3e635'];
  function teamColor(t) {
    if (!t) return '#64748b';
    var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return TEAM_COLORS[h % TEAM_COLORS.length];
  }
  function renderUsageChart() {
    var box = $('usageChart'); if (!box) return;
    var u = S.usage;
    $('ucTotal').textContent = u && u.pct != null ? Math.round(u.pct * 10) / 10 + '% used' : 'Total —';
    $('ucReset').textContent = u && u.resets ? 'Resets ' + fmtTime(u.resets) : (u && u.resetsRaw ? 'Resets ' + u.resetsRaw : '');
    var bots = S.roster.length ? S.roster.slice() : knownBots();
    var rows = bots.map(function (b) { return { bot: b, v: u && own(u.bots, b) ? u.bots[b] : null }; });
    rows.sort(function (a, c) {
      if (a.v == null && c.v == null) return a.bot.localeCompare(c.bot);
      if (a.v == null) return 1; if (c.v == null) return -1;
      return c.v - a.v || a.bot.localeCompare(c.bot);
    });
    var max = rows.reduce(function (m, r) { return r.v != null && r.v > m ? r.v : m; }, 0);
    var scale = max > 100 ? max : 100;
    box.textContent = '';
    if (!rows.length) { box.appendChild(el('div', 'empty', 'No bots in the feed yet.')); return; }
    rows.forEach(function (r) {
      var row = el('div', 'uc-row' + (r.v == null ? ' none' : ''));
      var lab = el('div', 'uc-label'); lab.appendChild(miniBot(r.bot)); lab.appendChild(el('span', 'uc-name', r.bot));
      row.appendChild(lab);
      var track = el('div', 'uc-track'), fill = el('div', 'uc-fill');
      var team = S._teamOf && S._teamOf[r.bot];
      fill.style.background = teamColor(team);
      fill.style.width = r.v == null ? '0' : Math.max(0, Math.min(100, r.v / scale * 100)) + '%';
      track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('div', 'uc-val', r.v == null ? '—' : Math.round(r.v * 10) / 10 + '%'));
      row.title = r.bot + (team ? ' · ' + team : '') + ' · ' + (r.v == null ? 'no share reported' : r.v + '%');
      box.appendChild(row);
    });
  }
  // ---------- team boards ----------
  var COLS = [
    { key: 'work', label: 'Working on', match: ['working', 'blocked'] },
    { key: 'owed', label: 'Owed to you', match: ['waiting_kevin'] },
    { key: 'next', label: 'Up next', match: ['next'] }
  ];
  function fmtDue(d) { return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function boardItem(it) {
    var li = el('li', 'bi ' + it.status);
    var top = el('div', 'bi-top');
    if (it.status === 'blocked') top.appendChild(el('span', 'tag error', 'blocked'));
    top.appendChild(el('span', 'bi-title', it.title));
    li.appendChild(top);
    var meta = el('div', 'bi-meta');
    if (it.owner) meta.appendChild(el('span', null, it.owner));
    if (it.since) { var a = el('span', null, fmtAge(it.since)); a.title = it.since.toLocaleString(); meta.appendChild(a); }
    if (it.due) {
      var over = it.status !== 'done' && it.due.getTime() < Date.now();
      meta.appendChild(el('span', 'due' + (over ? ' overdue' : ''), (over ? 'overdue · ' : 'due ') + fmtDue(it.due)));
    }
    if (meta.children.length) li.appendChild(meta);
    return li;
  }
  function byAge(a, c) {
    var x = a.since ? a.since.getTime() : Infinity, y = c.since ? c.since.getTime() : Infinity;
    return x - y;
  }
  function renderBoards() {
    var box = $('boards'); if (!box) return;
    box.textContent = '';
    var teams = Object.keys(S.boards);
    if (!teams.length) { box.appendChild(el('div', 'empty', 'No team boards posted yet.')); return; }
    var order = [];
    if (own(S.boards, 'HQ')) order.push('HQ');
    S.teamsOrder.forEach(function (t) { if (own(S.boards, t) && order.indexOf(t) < 0) order.push(t); });
    teams.sort().forEach(function (t) { if (order.indexOf(t) < 0) order.push(t); });
    order.forEach(function (tn) {
      var bd = S.boards[tn];
      var card = el('div', 'board');
      card.style.setProperty('--tc', teamColor(tn));
      var h = el('div', 'board-head');
      h.appendChild(el('span', 'board-name', tn));
      var up = el('span', 'board-up', 'updated ' + fmtAge(bd.updated) + (bd.bot ? ' · ' + bd.bot : ''));
      up.title = bd.updated.toLocaleString(); h.appendChild(up);
      card.appendChild(h);
      var cols = el('div', 'board-cols');
      COLS.forEach(function (c) {
        var items = bd.items.filter(function (i) { return c.match.indexOf(i.status) >= 0; }).sort(function (a, b) {
          return (c.key === 'work' ? (a.status === 'blocked' ? 0 : 1) - (b.status === 'blocked' ? 0 : 1) : 0) || byAge(a, b);
        });
        var col = el('div', 'bcol ' + c.key);
        var ch = el('h5', null, c.label); ch.appendChild(el('span', 'count', String(items.length)));
        col.appendChild(ch);
        var ul = el('ul', 'bi-list');
        if (!items.length) ul.appendChild(el('li', 'empty', 'Nothing here.'));
        items.forEach(function (it) { ul.appendChild(boardItem(it)); });
        col.appendChild(ul); cols.appendChild(col);
      });
      card.appendChild(cols);
      var done = bd.items.filter(function (i) { return i.status === 'done'; }).sort(byAge);
      if (done.length) {
        var det = el('details', 'bi-done');
        det.appendChild(el('summary', null, 'Done (' + done.length + ')'));
        var dl = el('ul', 'bi-list'); done.forEach(function (it) { dl.appendChild(boardItem(it)); });
        det.appendChild(dl); card.appendChild(det);
      }
      box.appendChild(card);
    });
  }
  setInterval(function () { renderKevin(); renderBoards(); }, 30000);

  // ---------- details panel ----------
  var panelBot = null;
  function openPanel(n) { panelBot = n; fillPanel(); $('panel').hidden = false; $('panelClose').focus(); }
  function fillPanel() {
    var n = panelBot; if (!n) return;
    var s = S.statuses[n];
    $('pName').textContent = n;
    $('pStatus').textContent = s ? s.status.replace('_', ' ') : 'idle (no status in feed)';
    $('pStep').textContent = s && s.step ? s.step : '—';
    $('pTime').textContent = s ? new Date(s.time).toLocaleString() : '—';
    $('pTeam').textContent = (S._teamOf && S._teamOf[n]) || '—';
    $('pUsage').textContent = S.usage && own(S.usage.bots, n) ? S.usage.bots[n] + '%' : '—';
    var ul = $('pRoutines'); ul.textContent = '';
    var rs = S.routines[n] || [];
    if (!rs.length) ul.appendChild(el('li', 'empty', 'None in feed.'));
    rs.forEach(function (r) { ul.appendChild(el('li', null, r.name + (r.schedule ? ' — ' + r.schedule : '') + (r.next ? ' (next ' + fmtTime(r.next) + ')' : ''))); });
    var c = $('pChat'); c.textContent = '';
    if (S.chat[n]) { var a = el('a', 'open-chat', 'Open chat'); a.href = S.chat[n]; a.rel = 'noopener noreferrer'; c.appendChild(a); }
    else c.appendChild(el('span', 'empty', 'No chat link in feed.'));
  }
  function closePanel() { $('panel').hidden = true; panelBot = null; }
  $('panelClose').addEventListener('click', closePanel);
  $('panel').addEventListener('click', function (e) { if (e.target === $('panel')) closePanel(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

  // ---------- clock ----------
  function tick() { $('clock').textContent = new Date().toLocaleTimeString(); renderTop(); }
  setInterval(tick, 1000); tick();

  // ---------- feed ----------
  window.addEventListener('hashchange', function () { location.reload(); });
  var raw = location.hash.slice(1);
  try { raw = decodeURIComponent(raw); } catch (e) { raw = ''; }
  if (!raw) { $('notice').hidden = false; $('notice').textContent = 'Add your feed topic after # in the address.'; return; }
  if (!TOPIC_RE.test(raw)) { $('notice').hidden = false; $('notice').textContent = 'That feed topic does not look valid (letters, numbers, - and _ only).'; return; }
  var TOPIC = raw;
  var BASE = 'https://ntfy.sh/' + encodeURIComponent(TOPIC);
  var renderQueued = false;
  function queueRender() { if (renderQueued) return; renderQueued = true; setTimeout(function () { renderQueued = false; render(); if (panelBot) fillPanel(); }, 50); }
  function setConn(c) { var e = $('conn'); e.className = 'conn ' + c; e.title = c === 'on' ? 'live' : c === 'poll' ? 'polling' : 'offline'; }

  function poll(since) {
    return fetch(BASE + '/json?poll=1&since=' + encodeURIComponent(since), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (txt) {
        var evs = [];
        txt.split('\n').forEach(function (line) { if (!line.trim()) return; try { evs.push(JSON.parse(line)); } catch (e) {} });
        evs.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
        evs.forEach(handleEvent);
        render();
      });
  }

  var es = null;
  function startSSE() {
    if (!window.EventSource) return;
    es = new EventSource(BASE + '/sse' + (lastId ? '?since=' + encodeURIComponent(lastId) : ''));
    es.onopen = function () { setConn('on'); };
    es.onmessage = function (m) { try { if (handleEvent(JSON.parse(m.data))) queueRender(); } catch (e) {} };
    es.onerror = function () { setConn(es.readyState === 2 ? 'off' : 'poll'); };
  }
  // fallback: re-poll every 30s whenever the live stream isn't open
  setInterval(function () {
    if (!es || es.readyState !== 1) poll(lastId || '12h').then(function () { setConn(es && es.readyState === 1 ? 'on' : 'poll'); }).catch(function () { setConn('off'); });
  }, 30000);
  setInterval(wander, 4000);

  render();
  poll('12h').catch(function () { setConn('off'); }).then(startSSE);
})();

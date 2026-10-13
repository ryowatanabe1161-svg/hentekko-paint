/* へんてこペイント：画面・お絵かきパッド・オンライン（PeerJS, ホストが正） */
'use strict';
var $ = function (id) { return document.getElementById(id); };
var E = window.HPE, W = E.loadWords(window.HP_CARDS);
var Q = new URLSearchParams(location.search), TURBO = Q.has('turbo');
if (Q.get('seed')) E.setSeed(+Q.get('seed'));
var D = function (ms) { return TURBO ? Math.max(30, ms / 12) : ms; };
var mode = null, G = null, mySeat = 0, localGate = null, lastRoll = 0, pumpT = null, confKey = '';
var pads = {};   // 描きかけの線（再描画で消えないように round:seat ごとに保持）
var padTool = 'L';
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
function show(id) { ['sTitle', 'sSetup', 'sOnline', 'sLobby', 'sGame'].forEach(function (s) { $(s).classList.toggle('hide', s !== id); }); window.scrollTo(0, 0); }
function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2200); }
function pname(p) { return (p.emoji || '') + esc(p.name); }

/* ---------- 描画 ---------- */
function fit(cv) { var r = cv.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1), w = Math.max(50, Math.round(r.width * dpr)); if (cv.width !== w) { cv.width = w; cv.height = w; } var c = cv.getContext('2d'); c.setTransform(w / 100, 0, 0, w / 100, 0, 0); return c; }
function drawStrokes(cv, st, upto, extra) {
  var c = fit(cv); c.clearRect(0, 0, 100, 100); c.lineCap = 'round'; c.lineJoin = 'round';
  var n = upto == null ? st.length : upto;
  for (var i = 0; i < n && i < st.length; i++) { var s = st[i]; c.strokeStyle = '#3b2f4a'; c.lineWidth = 2.2; c.beginPath();
    if (s[0] === 'C') c.arc(s[1], s[2], Math.max(.5, s[3]), 0, Math.PI * 2); else { c.moveTo(s[1], s[2]); c.lineTo(s[3], s[4]); } c.stroke(); }
  if (extra) extra(c);
}
function animateTile(cv, st, key) {
  if (animated[key]) { drawStrokes(cv, st); return; }
  animated[key] = 1; var i = 0, step = Math.max(60, Math.min(220, 1600 / Math.max(1, st.length)));
  (function f() { if (!cv.isConnected) return; drawStrokes(cv, st, i); if (i++ < st.length) setTimeout(f, D(step)); })();
}
var animated = {};

/* ---------- お絵かきパッド（直線・正円のみ。端点と中心にスナップ） ---------- */
function mountPad(cv, strokes, onChange) {
  var start = null, cur = null, snapHit = null;
  function pt(e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100]; }
  function snapPts() { var a = []; strokes.forEach(function (s) { if (s[0] === 'L') a.push([s[1], s[2]], [s[3], s[4]]); else a.push([s[1], s[2]]); }); return a; }
  function snap(p, from) {
    var best = null, bd = 3.8; snapPts().forEach(function (q) { var d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } });
    if (best) { snapHit = best; return best.slice(); } snapHit = null;
    if (from && padTool === 'L') {  // 水平・垂直・45°に吸着
      var dx = p[0] - from[0], dy = p[1] - from[1], len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), st = Math.PI / 4, ra = Math.round(ang / st) * st;
      if (Math.abs(ang - ra) < .07) return [from[0] + Math.cos(ra) * len, from[1] + Math.sin(ra) * len];
    }
    return p;
  }
  function make() { if (!start || !cur) return null;
    if (padTool === 'L') return ['L', start[0], start[1], cur[0], cur[1]];
    return ['C', start[0], start[1], Math.hypot(cur[0] - start[0], cur[1] - start[1])]; }
  function redraw() {
    drawStrokes(cv, strokes, null, function (c) {
      var s = make(); if (s) { c.setLineDash([2, 1.6]); c.strokeStyle = '#7a5af8'; c.lineWidth = 2; c.beginPath();
        if (s[0] === 'C') { c.arc(s[1], s[2], Math.max(.5, s[3]), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); c.fillStyle = '#7a5af8'; c.beginPath(); c.arc(s[1], s[2], .9, 0, 7); c.fill(); }
        else { c.moveTo(s[1], s[2]); c.lineTo(s[3], s[4]); c.stroke(); } c.setLineDash([]); }
      if (snapHit) { c.strokeStyle = '#ff7a59'; c.lineWidth = 1; c.beginPath(); c.arc(snapHit[0], snapHit[1], 2.6, 0, 7); c.stroke(); }
    });
  }
  cv.onpointerdown = function (e) { e.preventDefault(); cv.setPointerCapture(e.pointerId); start = snap(pt(e)); cur = start; redraw(); };
  cv.onpointermove = function (e) { if (!start) return; e.preventDefault(); cur = snap(pt(e), start); redraw(); };
  cv.onpointerup = cv.onpointercancel = function (e) {
    if (!start) return; var s = make(); start = cur = null; snapHit = null;
    if (s && (s[0] === 'L' ? Math.hypot(s[3] - s[1], s[4] - s[2]) >= 1.5 : s[3] >= 1.2)) { strokes.push(s.map(function (v, i) { return i ? Math.round(v * 10) / 10 : v; })); onChange(); }
    redraw();
  };
  redraw(); return { redraw: redraw };
}

/* ---------- 進行（ローカル／ホスト） ---------- */
function doAct(a) {
  if (mode === 'client') { send({ t: 'act', a: a }); return; }
  var from = mode === 'host' ? 0 : null;
  if (a.p == null && a.t === 'submit') return;
  if (E.act(G, W, a, mode === 'host' && a.t !== 'submit' ? from : null)) changed();
}
function changed() { render(); pump(); if (mode === 'host') broadcast(); }
function pump() {
  clearTimeout(pumpT); if (!G) return; var ap = G.players[G.ans];
  if (G.phase === 'roll' && ap.cpu != null) pumpT = setTimeout(function () { if (E.act(G, W, { t: 'roll' }, null)) changed(); }, D(1300));
  else if (G.phase === 'reveal' && ap.cpu != null) pumpT = setTimeout(function () {
    var txt = E.cpuGuess(G, W, ap.cpu); if (E.act(G, W, { t: 'guess', text: txt }, null)) changed(); }, D(2300 + 300 * ((G.drawings[G.order[G.revealed - 1]] || []).length > 8 ? 2 : 1)));
}
function view() { return mode === 'host' ? E.viewFor(G, 0) : G; }

/* ---------- 画面 ---------- */
function render() {
  if (!G) return; show('sGame'); var V = view(), P = V.players, n = P.length, ans = V.ans, me = mode === 'local' ? null : mySeat;
  $('scores').innerHTML = P.map(function (p, i) { return '<span class="chip' + (i === ans && V.phase !== 'end' ? ' ans' : '') + '">' + (i === ans && V.phase !== 'end' ? '🎯' : '') + pname(p) + ' <b>' + p.score + '</b>' + (i === me ? '（あなた）' : '') + '</span>'; }).join('');
  var humans = P.filter(function (p) { return p.cpu == null; }).length;
  var ansHuman = P[ans].cpu == null, canAns = mode === 'local' ? ansHuman : me === ans;
  var head = '<div class="phase">第' + (V.round + 1) + '/' + n + '回　回答者：' + pname(P[ans]) + '</div>';
  var h = '', after = [];
  var cnt = function (i) { return V.drawCounts ? V.drawCounts[i] : (V.drawings[i] ? V.drawings[i].length : -1); };
  if (V.phase === 'roll') {
    h = head + '<div class="card"><div class="topic">' + [1, 2, 3, 4, 5, 6].map(function (k) { return '<div><i>' + k + '</i>？？？</div>'; }).join('') + '</div></div>';
    h += canAns ? '<button class="btn" id="bRoll">🎲 サイコロをふる</button><div style="text-align:center;font-size:13px;color:#998">出た番号の言葉がお題。あなたには見えません！</div>'
      : '<div class="card" style="text-align:center">' + pname(P[ans]) + ' がサイコロをふります…</div>';
    after.push(function () { var b = $('bRoll'); if (b) b.onclick = function () { b.disabled = true; doAct({ t: 'roll' }); }; });
  } else if (V.phase === 'draw') {
    var who = null, wait = false;
    if (mode === 'local') {
      var pend = []; for (var i = 0; i < n; i++) if (i !== ans && P[i].cpu == null && !V.drawings[i]) pend.push(i);
      if (pend.length) { who = pend[0]; if (humans > 1 && localGate !== who) {
        h = head + '<div class="card gate"><div class="em">🙈</div><p>回答者の <b>' + pname(P[ans]) + '</b> は見ないでね！</p><p>次は <b>' + pname(P[who]) + '</b> が描く番です。</p><button class="btn" id="bGate">' + esc(P[who].name) + 'さん、タップして描く</button></div>';
        var gw = who; after.push(function () { $('bGate').onclick = function () { localGate = gw; render(); }; }); who = -1; } }
      else wait = true;
    } else { if (me !== ans && cnt(me) === -1) who = me; else wait = true; }
    if (who != null && who >= 0) h = drawUI(V, who, head, after);
    else if (wait) {
      h = head + '<div class="card"><div style="text-align:center;margin-bottom:6px">' + (me === ans ? '🤫 みんながお題を描いています…' : '✅ 描けました！ほかの人を待っています…') + '</div>' +
        P.map(function (p, i) { return i === ans ? '' : '<div>' + (cnt(i) >= 0 ? '✅' : '✏️') + ' ' + pname(p) + '</div>'; }).join('') + '</div>';
      if (mode === 'host') { h += '<button class="btn sm g" id="bSkip">⏭ 待たずに進める（切断した人をとばす）</button>'; after.push(function () { $('bSkip').onclick = function () { if (confirm('まだ描いていない人をとばしますか？')) doAct({ t: 'skipWaiting' }); }; }); }
    }
  } else if (V.phase === 'reveal' || V.phase === 'roundEnd') {
    var end = V.phase === 'roundEnd';
    if (!end) h = head + '<div style="text-align:center;font-size:14px">画数の少ない順に公開中：<b>' + V.revealed + '</b> / ' + V.order.length + ' 枚目</div>';
    else {
      var tw = W[V.target], R = V.result;
      h = head + '<div class="card" style="text-align:center"><div>お題は…</div><div class="big">「' + esc(tw.w) + '」</div>' +
        (R.ok ? '<div>🎉 <b>' + R.k + '枚目</b>で正解！ ' + pname(P[R.drawer]) + ' +2点 ／ ' + pname(P[ans]) + ' +' + (R.k === 1 ? 3 : R.k <= 3 ? 2 : 1) + '点</div>' : '<div>😢 だれも当てられませんでした</div>') + '</div>';
      if (R.ok && confKey !== V.round + ':' + V.rollId) { confKey = V.round + ':' + V.rollId; confetti(); }
    }
    h += '<div class="tiles">' + V.order.map(function (pi, j) {
      var vis = end || j < V.revealed, d = V.drawings[pi], c = cnt(pi);
      var hit = V.result && V.result.ok && V.result.drawer === pi;
      return vis && d ? '<div class="tile' + (hit ? ' hit' : '') + '"><span class="no">' + (j + 1) + '</span><canvas data-p="' + pi + '"></canvas><div class="cap">' + pname(P[pi]) + '・' + d.length + '画</div></div>'
        : '<div class="tile wait">？<small>' + (j + 1) + '番目・' + pname(P[pi]) + '・' + c + '画</small></div>';
    }).join('') + '</div>';
    if (V.guesses.length) h += '<div class="card glist">' + V.guesses.map(function (g) { return '<div>' + g.k + '枚目：「' + esc(g.text) + '」 ' + (g.ok ? '<span class="ok">⭕ 正解' + (g.overridden ? '（描いた人の判定）' : '') + '</span>' : '<span class="ng">❌</span>') + '</div>'; }).join('') + '</div>';
    var lastG = V.guesses[V.guesses.length - 1];
    var canOv = lastG && !lastG.ok && lastG.text !== '（パス）' && (mode === 'local' ? true : (me !== ans)) && (!end || !V.result.ok);
    if (!end) {
      if (canAns) {
        h += '<div class="card"><div style="font-size:13px;margin-bottom:4px">何の絵かな？（' + V.revealed + '枚目を見て1回答えられます）</div><div class="row"><input type="text" id="gIn" maxlength="20" placeholder="こたえ" autocomplete="off"><button class="btn sm" id="gGo" style="flex:0 0 auto">答える</button></div><button class="btn sm g" id="gPass">わからない（次の絵へ）</button></div>';
        after.push(function () { var go = function () { var v = $('gIn').value.trim(); if (!v) return; doAct({ t: 'guess', text: v }); };
          $('gGo').onclick = go; $('gIn').onkeydown = function (e) { if (e.key === 'Enter' && !e.isComposing) go(); }; $('gPass').onclick = function () { doAct({ t: 'guess', text: '' }); }; });
      } else h += '<div class="card" style="text-align:center">' + (P[ans].cpu != null ? '🤔 ' + pname(P[ans]) + ' が考え中…' : pname(P[ans]) + ' が答えます…') + '</div>';
    }
    if (canOv) { h += '<button class="btn sm g" id="bOv">↩︎ さっきの「' + esc(lastG.text) + '」は正解にする（描いた人の判定）</button>';
      after.push(function () { $('bOv').onclick = function () { if (confirm('「' + lastG.text + '」を正解にしますか？')) doAct({ t: 'override' }); }; }); }
    if (end) {
      h += '<div class="card"><div class="topic">' + V.card.map(function (id, k) { return '<div class="' + (k === V.die - 1 ? 'on' : '') + '"><i>' + (k + 1) + '</i>' + esc(W[id].w) + '</div>'; }).join('') + '</div></div>';
      if (mode !== 'client') { h += '<button class="btn" id="bNext">' + (V.round + 1 >= n ? '結果発表へ' : '次の回へ（回答者は左隣）') + '</button>'; after.push(function () { $('bNext').onclick = function () { localGate = null; doAct({ t: 'next' }); }; }); }
      else h += '<div style="text-align:center;color:#998">ホストが次へ進めるのを待っています…</div>';
    }
    after.push(function () { document.querySelectorAll('.tile canvas').forEach(function (cv) { var pi = +cv.dataset.p; animateTile(cv, V.drawings[pi], V.round + ':' + V.rollId + ':' + pi); }); });
  } else if (V.phase === 'end') {
    var rk = E.ranking(V);
    h = '<div class="phase">🏁 結果発表</div><div class="card">' + rk.map(function (r, j) { return '<div class="seat"><span class="em">' + (r.win ? '🏆' : ['', '🥈', '🥉'][j] || '　') + '</span><span style="flex:1">' + pname(r.p) + '</span><b style="font-size:22px;color:#ff7a59">' + r.p.score + '点</b></div>'; }).join('') + '</div>';
    if (mode !== 'client') h += '<button class="btn" id="bAgain">もう一度（同じメンバー）</button>';
    h += '<button class="btn g" id="bTitle">タイトルへ</button>';
    if (rk[0].win) confetti();
    after.push(function () { var a = $('bAgain'); if (a) a.onclick = function () { G = E.newGame(G.players.map(function (p) { return { name: p.name, emoji: p.emoji, cpu: p.cpu, seat: p.seat }; }), W); E.startRound(G); localGate = null; pads = {}; changed(); };
      $('bTitle').onclick = function () { location.href = location.pathname; }; });
  }
  if (V.die && V.rollId > lastRoll) { lastRoll = V.rollId; diceAnim(V.die); }
  $('gameBody').innerHTML = h; after.forEach(function (f) { f(); });
}
function drawUI(V, who, head, after) {
  var key = V.round + ':' + who, st = pads[key] || (pads[key] = []), P = V.players;
  var h = head + '<div class="gameGrid"><div><div class="card"><div style="font-size:13px;text-align:center">' + pname(P[who]) + ' のお題（サイコロ：' + V.die + '）</div><div class="big">「' + esc(W[V.target].w) + '」</div><div class="topic">' +
    V.card.map(function (id, k) { return '<div class="' + (k === V.die - 1 ? 'on' : '') + '"><i>' + (k + 1) + '</i>' + esc(W[id].w) + '</div>'; }).join('') + '</div></div></div><div>' +
    '<canvas class="cv" id="pad"></canvas><div class="tools"><button id="tL" class="' + (padTool === 'L' ? 'on' : '') + '">／ 直線</button><button id="tC" class="' + (padTool === 'C' ? 'on' : '') + '">◯ 円</button><button id="tU">↩︎ 戻す</button><button id="tX">🗑 全消し</button></div>' +
    '<div class="count">画数 <b id="cnt">' + st.length + '</b>　<small style="color:#998">（少ないほど先に見せられる！）</small></div>' +
    '<div style="font-size:12px;color:#998;text-align:center">直線：始点から終点へドラッグ／円：中心から外へドラッグ。文字・記号はダメ（線だけの矢印はOK）</div>' +
    '<button class="btn b3" id="bDone">これで完成！</button></div></div>';
  after.push(function () {
    var cv = $('pad'), pad, upd = function () { $('cnt').textContent = st.length; $('bDone').textContent = 'これで完成！（' + st.length + '画）'; $('bDone').disabled = !st.length; };
    pad = mountPad(cv, st, upd); upd();
    $('tL').onclick = function () { padTool = 'L'; $('tL').className = 'on'; $('tC').className = ''; };
    $('tC').onclick = function () { padTool = 'C'; $('tC').className = 'on'; $('tL').className = ''; };
    $('tU').onclick = function () { st.pop(); pad.redraw(); upd(); };
    $('tX').onclick = function () { if (st.length && confirm('全部消しますか？')) { st.length = 0; pad.redraw(); upd(); } };
    $('bDone').onclick = function () { if (!st.length) return; $('bDone').disabled = true; localGate = null; doAct({ t: 'submit', p: who, strokes: st.slice() }); };
  });
  return h;
}
var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHTML(n) { return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return '<div class="pip' + (PIPS[n].indexOf(i) > -1 ? ' v' : '') + '"></div>'; }).join(''); }
function diceAnim(n) {
  var o = document.createElement('div'); o.className = 'dice'; o.id = 'diceOv'; o.innerHTML = '<div class="die spin">' + dieHTML(1) + '</div><div id="diceT">コロコロ…</div>'; document.body.appendChild(o);
  var die = o.firstChild, t = 0, iv = setInterval(function () { die.innerHTML = dieHTML(1 + (t++ % 6)); }, D(90));
  setTimeout(function () { clearInterval(iv); die.className = 'die land'; die.innerHTML = dieHTML(n); o.querySelector('#diceT').textContent = n + ' が出た！'; }, D(1100));
  setTimeout(function () { o.remove(); }, D(2100)); o.onclick = function () { o.remove(); };
}
function confetti() { if (TURBO) return; for (var i = 0; i < 18; i++) { var s = document.createElement('div'); s.className = 'conf'; s.textContent = ['🎉', '✨', '🖍️', '⭐'][i % 4]; s.style.left = (Math.random() * 100) + 'vw'; s.style.animationDelay = (Math.random() * .6) + 's'; document.body.appendChild(s); setTimeout(function (x) { x.remove(); }.bind(null, s), 2600); } }

/* ---------- ローカルの席設定 ---------- */
var seats = (function () { try { return JSON.parse(localStorage.getItem('hp_seats')) || null; } catch (e) { return null; } })() ||
  [{ h: 1, name: 'あなた' }, { ch: 0, lv: 1 }, { ch: 1, lv: 1 }, { ch: 2, lv: 1 }];
function lvSel(v, attr) { return '<select ' + attr + '>' + E.LV.map(function (l, i) { return '<option value="' + i + '"' + (i === v ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select>'; }
function renderSeats() {
  $('seatList').innerHTML = seats.map(function (s, i) {
    if (s.h) return '<div class="seat"><span class="em">🙂</span><input type="text" data-n="' + i + '" value="' + esc(s.name) + '" maxlength="10"><button class="x" data-x="' + i + '">×</button></div>';
    return '<div class="seat"><span class="em">' + E.CHARS[s.ch][1] + '</span><select data-c="' + i + '">' + E.CHARS.map(function (c, k) { return '<option value="' + k + '"' + (k === s.ch ? ' selected' : '') + '>' + c[0] + '</option>'; }).join('') + '</select>' + lvSel(s.lv, 'data-l="' + i + '"') + '<button class="x" data-x="' + i + '">×</button></div>';
  }).join('');
  $('seatList').querySelectorAll('[data-n]').forEach(function (e) { e.oninput = function () { seats[+e.dataset.n].name = e.value; }; });
  $('seatList').querySelectorAll('[data-c]').forEach(function (e) { e.onchange = function () { seats[+e.dataset.c].ch = +e.value; renderSeats(); }; });
  $('seatList').querySelectorAll('[data-l]').forEach(function (e) { e.onchange = function () { seats[+e.dataset.l].lv = +e.value; }; });
  $('seatList').querySelectorAll('[data-x]').forEach(function (e) { e.onclick = function () { if (seats.length > 1) { seats.splice(+e.dataset.x, 1); renderSeats(); } }; });
}
function freeChar(list) { for (var k = 0; k < 6; k++) if (!list.some(function (s) { return s.ch === k; })) return k; return 0; }
$('goLocal').onclick = function () { renderSeats(); show('sSetup'); };
$('addHuman').onclick = function () { if (seats.length < 6) { seats.push({ h: 1, name: 'プレイヤー' + (seats.length + 1) }); renderSeats(); } };
$('addCpu').onclick = function () { if (seats.length < 6) { seats.push({ ch: freeChar(seats), lv: 1 }); renderSeats(); } };
$('startLocal').onclick = function () {
  if (seats.length < 3) return toast('3人以上にしてね（CPUを足せます）');
  if (!seats.some(function (s) { return s.h; })) return toast('人を1人以上入れてね');
  try { localStorage.setItem('hp_seats', JSON.stringify(seats)); } catch (e) {}
  mode = 'local'; G = E.newGame(seats.map(function (s) { return s.h ? { name: (s.name || '').trim() || 'ななし', emoji: '🙂' } : { name: E.CHARS[s.ch][0], emoji: E.CHARS[s.ch][1], cpu: s.lv }; }), W);
  E.startRound(G); changed();
};
$('backTitle1').onclick = $('backTitle2').onclick = function () { show('sTitle'); };
$('goRules').onclick = function () { $('rules').classList.remove('hide'); };
$('rulesClose').onclick = function () { $('rules').classList.add('hide'); };
$('goOnline').onclick = function () { $('onName').value = localStorage.getItem('hp_name') || ''; show('sOnline'); };

/* ---------- オンライン ---------- */
var ID_PREFIX = 'hentekko-v1-', CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var ICE = Q.get('ice') ? Q.get('ice').split(',').map(function (u) { return { urls: u }; }) : [{ urls: 'stun:stun.l.google.com:19302' }];
var PEER_OPTS = { debug: 1, config: { iceServers: ICE } };
if (Q.get('peerhost')) { PEER_OPTS.host = Q.get('peerhost'); PEER_OPTS.port = +Q.get('peerport'); PEER_OPTS.path = Q.get('peerpath') || '/'; PEER_OPTS.secure = false; }
var PARTY = window.FuuParty && window.FuuParty.info;   // ひろばの「みんなの部屋」から来たとき
var peer = null, conns = [], hostConn = null, lobby = null, roomCode = '';
function genCode() { var s = ''; for (var i = 0; i < 4; i++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; return s; }
function myName() { var n = $('onName').value.trim().slice(0, 10); if (!n) { toast('なまえを入れてね'); return null; } localStorage.setItem('hp_name', n); return n; }
$('mkRoom').onclick = function () {
  var nm = myName(); if (!nm) return; mode = 'host'; roomCode = (PARTY && PARTY.host) ? PARTY.code : (Q.get('code') || genCode());
  lobby = [{ name: nm, emoji: '🙂', seat: 'host' }];
  peer = new Peer(ID_PREFIX + roomCode, PEER_OPTS);
  peer.on('open', function () { renderLobby(); });
  peer.on('error', function (e) { if (e.type === 'unavailable-id' && PARTY) { try { peer.destroy(); } catch (x) {} toast('部屋を開いています…'); setTimeout(function () { $('mkRoom').onclick(); }, 2500); } else if (e.type === 'unavailable-id') { roomCode = genCode(); toast('コードを作り直します'); setTimeout(function () { $('mkRoom').onclick(); }, 300); } else toast('通信エラー：' + e.type); });
  peer.on('connection', function (c) {
    c.on('data', function (m) { hostRecv(c, m); });
    c.on('close', function () { conns = conns.filter(function (x) { return x !== c; }); if (lobby && !G) { lobby = lobby.filter(function (p) { return p.seat !== c.peer; }); renderLobby(); } });
  });
};
function hostRecv(c, m) {
  if (m.t === 'hello') {
    if (!G) { if (lobby.length >= 6) { c.send({ t: 'err', msg: '満員です' }); return; }
      lobby.push({ name: String(m.name || 'ななし').slice(0, 10), emoji: '🙂', seat: c.peer }); conns.push(c); renderLobby(); return; }
    // ゲーム中：同じ名前の人の再接続を受け付ける
    var idx = G.players.findIndex(function (p) { return p.cpu == null && p.name === m.name && p.seat !== 'host'; });
    if (idx < 0) { c.send({ t: 'err', msg: 'ゲームはもう始まっています' }); return; }
    G.players[idx].seat = c.peer; conns.push(c); broadcast(); return;
  }
  if (m.t === 'act' && G) { var seat = G.players.findIndex(function (p) { return p.seat === c.peer; }); if (seat < 0) return;
    var a = m.a || {}; if (a.t === 'next' || a.t === 'skipWaiting') return;   // 進行はホストだけ
    if (a.t === 'submit') a.p = seat;
    if (E.act(G, W, a, seat)) changed(); }
}
function broadcast() {
  if (!G) { conns.forEach(function (c) { try { c.send({ t: 'lobby', players: lobby, code: roomCode }); } catch (e) {} }); return; }
  conns.forEach(function (c) { var s = G.players.findIndex(function (p) { return p.seat === c.peer; }); if (s >= 0) try { c.send({ t: 'state', g: E.viewFor(G, s), seat: s }); } catch (e) {} });
}
function renderLobby() {
  show('sLobby'); $('lobCode').textContent = roomCode;
  var L = lobby || [];
  $('lobList').innerHTML = L.map(function (p, i) { return '<div class="seat"><span class="em">' + (p.emoji || '🙂') + '</span><span style="flex:1">' + esc(p.name) + (p.cpu != null ? '（' + E.LV[p.cpu] + '）' : '') + (i === 0 ? ' 👑' : '') + '</span>' + (mode === 'host' && i > 0 ? '<button class="x" data-k="' + i + '">×</button>' : '') + '</div>'; }).join('') +
    (mode === 'host' ? '<div style="margin-top:6px;font-size:13px">CPUの強さ ' + lvSel(+(localStorage.getItem('hp_lv') || 1), 'id="lobLv"') + '</div>' : '');
  $('lobHost').classList.toggle('hide', mode !== 'host'); $('lobWait').classList.toggle('hide', mode === 'host');
  if (mode === 'host') {
    $('lobList').querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { var p = lobby[+b.dataset.k]; if (p.cpu == null) { var c = conns.find(function (x) { return x.peer === p.seat; }); if (c) { c.send({ t: 'err', msg: 'ホストに外されました' }); conns = conns.filter(function (x) { return x !== c; }); } } lobby.splice(+b.dataset.k, 1); renderLobby(); }; });
    $('lobLv').onchange = function () { localStorage.setItem('hp_lv', this.value); };
    $('lobStart').disabled = L.length < 3; $('lobStart').textContent = L.length < 3 ? '3人以上で始められます（CPU可）' : 'スタート！（' + L.length + '人）';
    broadcast();
  }
}
$('lobCpu').onclick = function () { if (lobby.length >= 6) return toast('6人までです'); var used = lobby.map(function (p) { return p.ch; }), ch = 0; while (used.indexOf(ch) > -1) ch++; var lv = +$('lobLv').value; lobby.push({ name: E.CHARS[ch][0], emoji: E.CHARS[ch][1], cpu: lv, ch: ch }); renderLobby(); };
$('lobStart').onclick = function () { if (lobby.length < 3) return; G = E.newGame(lobby, W); E.startRound(G); mySeat = 0; changed(); };
$('lobLeave').onclick = function () { location.href = location.pathname; };
$('copyLink').onclick = function () { var u = location.origin + location.pathname + '?room=' + roomCode; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast('コピーしました'); }, function () { prompt('このリンクを送ってね', u); }); };
$('joinRoom').onclick = function () {
  var nm = myName(); if (!nm) return; var code = $('onCode').value.trim().toUpperCase(); if (code.length < 4) return toast('部屋コードを入れてね');
  mode = 'client'; roomCode = code; peer = new Peer(PEER_OPTS); toast('つないでいます…');
  var ptries = 0;
  function connect() { hostConn = peer.connect(ID_PREFIX + code, { reliable: true });
    hostConn.on('open', function () { hostConn.send({ t: 'hello', name: nm }); });
    hostConn.on('data', function (m) {
      if (m.t === 'fuu-goto') { if (PARTY) FuuParty.handle(m); }
      else if (m.t === 'lobby') { lobby = m.players; renderLobby(); }
      else if (m.t === 'state') { G = m.g; mySeat = m.seat; render(); }
      else if (m.t === 'err') { toast(m.msg); setTimeout(function () { location.href = location.pathname; }, 1800); }
    });
    hostConn.on('close', function () { toast('ホストとの接続が切れました'); });
  }
  peer.on('open', connect);
  if (PARTY) var watch = setInterval(function () { if (lobby || G) { clearInterval(watch); return; } if (peer.open && !(hostConn && hostConn.open)) { try { hostConn && hostConn.close(); } catch (e) {} connect(); } }, FuuParty.watchMs);   // みんなの部屋：取りこぼし対策
  peer.on('error', function (e) { if (e.type === 'peer-unavailable' && PARTY && !lobby && ++ptries < FuuParty.retries) { toast('ホストを待っています…'); setTimeout(connect, FuuParty.retryMs); return; } toast(e.type === 'peer-unavailable' ? 'その部屋が見つかりません' : '通信エラー：' + e.type); });
};
function send(m) { if (hostConn && hostConn.open) hostConn.send(m); else toast('つながっていません'); }
// ---- ひろばの「みんなの部屋」：同じメンバーで自動入室＋ホストは「つぎのゲーム」 ----
if (PARTY) {
  FuuParty.init({ game: 'hentekko-paint',
    isHost: function () { return mode === 'host'; },
    canSwitch: function () { return mode !== 'host' || !G || G.phase === 'end'; },
    broadcast: function (m) { conns.forEach(function (c) { try { c.send(m); } catch (e) {} }); } });
  FuuParty.status = function () { return mode === 'host' ? { host: 1, n: conns.filter(function (c) { return c.open; }).length } : { host: 0, joined: !!(lobby || G) }; };
  $('goOnline').onclick(); $('onName').value = PARTY.name || 'ななし';
  if (PARTY.host) $('mkRoom').onclick(); else { $('onCode').value = PARTY.code; $('joinRoom').onclick(); }
} else if (Q.get('room')) { $('onCode').value = Q.get('room'); $('goOnline').onclick(); }

/* タイトルのお絵かきデモ */
(function () { var cv = $('titleCv'), i = 0, list = E.shuffle(W.filter(function (w) { return !w.hard; })).slice(0, 12);
  function loop() { if (!cv.isConnected || $('sTitle').classList.contains('hide')) return setTimeout(loop, 1500); var w = list[i++ % list.length], st = w.draw.slice(0, w.ess), k = 0;
    (function f() { drawStrokes(cv, st, k, function (c) { if (k > st.length) { c.font = '7px sans-serif'; c.fillStyle = '#ff7a59'; c.textAlign = 'center'; c.fillText(w.w + '（' + st.length + '画）', 50, 98); } }); if (k++ <= st.length) setTimeout(f, 180); else setTimeout(loop, 1600); })(); }
  setTimeout(loop, 200); })();
window.HP_DEBUG = { get G() { return G; }, W: W, E: E, doAct: doAct };

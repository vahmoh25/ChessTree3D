/* Application controller: game flow, AI driver, HUD, inspector. */
(function (G) {
  'use strict';
  const CH = G.CH, EV = G.EV, SR = G.SR, ST = SR.ST, fmt = G.fmtVal;
  const $ = id => document.getElementById(id);
  const GL = ['', '♟', '♞', '♝', '♜', '♛', '♚'];
  const glyph = (p, cls) => `<span class="${(p >> 3) ? 'gB' : 'gW'}">${GL[p & 7]}︎</span>`;
  const PIECE_VAL = [0, 1, 3, 3, 5, 9, 0];
  const RATES = [4, 10, 25, 60, 140, 350, Infinity];
  const RATE_TXT = ['4 nodes/s', '10 nodes/s', '25 nodes/s', '60 nodes/s', '140 nodes/s', '350 nodes/s', 'instant'];
  const LINE_COLORS = ['#ffffff', '#4cc9f0', '#ff6bd6', '#ffd60a', '#7dffa8', '#ff9a5a', '#a99bff'];

  const game = new CH.Game();
  const board = new G.BoardView($('boardGL'), { onClick: onBoardClick });
  const tree = new G.TreeView($('treeGL'), { onSelect: onTreeSelect, onHover: onTreeHover });

  const settings = { mode: 'hw', depth: 3, treeDepth: 3, speed: 4, prune: true, order: true, arrows: true };
  let paused = false, stepReq = false;
  let cur = null;           // current/last search run {S, purpose, ...}
  let searchId = 0;
  let selectedSq = -1, gameOver = false, pendingPromo = null;
  let hudT = 0, inspT = 0;
  let arrowKey = '';
  let flipped = false;

  /* ---------- helpers ---------- */
  const humanColor = () => settings.mode === 'hw' ? 0 : settings.mode === 'hb' ? 1 : -1;
  const isAITurn = () => settings.mode === 'aa' || game.pos.turn !== humanColor();
  const colorName = c => c ? 'Black' : 'White';
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const signCls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  const san = n => cur && tree.search ? tree.search.sanOf(n) : '?';

  /* ---------- game flow ---------- */
  function newGame() {
    cancelSearch();
    game.reset();
    gameOver = false; selectedSq = -1; paused = false; stepReq = false;
    board.setPosition(game.pos); board.setLast(-1, -1); board.setSelected(-1); board.setCheck(-1); board.setArrows([]);
    board.setPerspective(humanColor() === 1);
    $('banner').classList.add('hidden'); $('promo').classList.add('hidden');
    tree.setSearch(null);
    inspect(null);
    log('st', 'New game — ' + $('mode').selectedOptions[0].text);
    refreshAll();
  }

  function cancelSearch() {
    cur = null;
    tree.setSearch(null);
    $('log').innerHTML = '';
  }

  function doMove(m) {
    game.play(m);
    board.playMove(m);
    selectedSq = -1; board.setSelected(-1);
    $('promo').classList.add('hidden'); pendingPromo = null;
    refreshAll();
  }

  function refreshAll() {
    const st = game.status();
    const pos = game.pos;
    gameOver = st.over;
    $('turnPill').classList.toggle('black', !!pos.turn);
    $('turnText').textContent = st.over ? 'Game over' : colorName(pos.turn) + ' to move';
    const note = $('statusLine');
    if (st.over) { note.textContent = st.reason + (st.winner >= 0 ? ' — ' + colorName(st.winner) + ' wins' : ' — draw'); note.className = 'note show warn'; }
    else if (st.check) { note.textContent = colorName(pos.turn) + ' is in check'; note.className = 'note show warn'; }
    else { note.textContent = ''; note.className = 'note'; }
    board.setCheck(st.check || (st.over && st.reason === 'Checkmate') ? pos.kings[pos.turn] : -1);
    if (st.over) showBanner(st);
    renderCaptured(); renderHistory(); renderEvalBar();
    const last = game.records[game.records.length - 1];
    if (last) board.setLast(CH.mFrom(last.m), CH.mTo(last.m)); else board.setLast(-1, -1);
    updateButtons();
    if (!tree.selected) inspect(null);
  }

  function showBanner(st) {
    $('bannerTitle').textContent = st.winner >= 0 ? colorName(st.winner) + ' wins' : 'Draw';
    $('bannerText').textContent = st.reason + (settings.mode === 'aa' ? '' : (st.winner === humanColor() ? ' — well played!' : ''));
    $('banner').classList.remove('hidden');
  }

  function updateButtons() {
    $('btnUndo').disabled = game.records.length === 0;
    $('btnPause').textContent = paused ? 'Resume' : 'Pause';
    $('btnPause').classList.toggle('primary', true);
    $('btnStep').disabled = !paused;
    $('btnHint').disabled = gameOver || settings.mode === 'aa' || isAITurn();
  }

  function undo() {
    if (!game.records.length) return;
    cancelSearch();
    let n = 0;
    do { game.undo(); n++; } while (game.records.length && settings.mode !== 'aa' && game.pos.turn !== humanColor());
    gameOver = false; $('banner').classList.add('hidden');
    if (settings.mode === 'aa') paused = true;
    board.setPosition(game.pos); board.setSelected(-1); board.setArrows([]);
    selectedSq = -1;
    inspect(null);
    refreshAll();
  }

  /* ---------- human input ---------- */
  board.interactive = sq => {
    if (gameOver || isAITurn() || board.busy) return false;
    const p = game.pos.board[sq];
    return (p && (p >> 3) === game.pos.turn) || (selectedSq >= 0 && game.legal().some(m => CH.mFrom(m) === selectedSq && CH.mTo(m) === sq));
  };

  function onBoardClick(sq) {
    if (gameOver || board.busy || isAITurn() || pendingPromo) return;
    if (cur && cur.purpose === 'hint') { cur = null; board.setArrows([]); arrowKey = ''; }
    const legal = game.legal();
    if (selectedSq >= 0) {
      const c = legal.filter(m => CH.mFrom(m) === selectedSq && CH.mTo(m) === sq);
      if (c.length) {
        if (c.length > 1) { askPromotion(c); return; }
        doMove(c[0]); return;
      }
    }
    const p = game.pos.board[sq];
    if (p && (p >> 3) === game.pos.turn) {
      selectedSq = sq;
      board.setSelected(sq, legal.filter(m => CH.mFrom(m) === sq).map(m => ({ to: CH.mTo(m), ep: !!(CH.mFlags(m) & CH.F_EP) })));
    } else { selectedSq = -1; board.setSelected(-1); }
  }

  function askPromotion(cands) {
    pendingPromo = cands;
    const box = $('promoBtns'); box.innerHTML = '';
    const color = game.pos.turn;
    [CH.Q, CH.R, CH.B, CH.N].forEach(t => {
      const b = document.createElement('button');
      b.innerHTML = glyph(t | (color << 3));
      b.onclick = () => { const m = cands.find(x => CH.mPromo(x) === t); doMove(m); };
      box.appendChild(b);
    });
    $('promo').classList.remove('hidden');
  }

  /* ---------- AI driver ---------- */
  function startSearch(purpose) {
    const depth = !settings.prune ? Math.min(3, settings.depth) : settings.depth;
    const S = new SR.Search(game.pos, { depth, treeDepth: settings.treeDepth, prune: settings.prune, order: settings.order });
    S.rootOut = {}; EV.evaluate(S.rootPos, S.rootOut);
    cur = { S, id: ++searchId, purpose, acc: 0, thinkMs: 0, computeMs: 0, logIdx: 0, finished: false, moved: false, hold: 0.9, ply: game.records.length, side: game.pos.turn };
    tree.setSearch(S);
    $('log').innerHTML = '';
    inspect(null);
    arrowKey = '';
  }

  function restartIfRunning() {
    if (cur && !cur.moved) { cur = null; tree.setSearch(null); $('log').innerHTML = ''; }
  }

  function pump(dt) {
    if (!cur || cur.S.done) return;
    if (paused && !stepReq) return;
    const rate = RATES[settings.speed - 1];
    let n;
    if (stepReq) { n = 1; stepReq = false; }
    else if (rate === Infinity) n = 1e9;
    else { cur.acc += dt * rate; n = Math.floor(cur.acc); cur.acc -= n; }
    const t0 = performance.now();
    let i = 0;
    while (i < n) {
      if (!cur.S.step()) break;
      i++;
      if (rate === Infinity && performance.now() - t0 > 12) break;
    }
    cur.computeMs += performance.now() - t0;
    cur.thinkMs += dt * 1000;
  }

  function tick(dt) {
    if (!gameOver && !board.busy && !pendingPromo) {
      const running = cur && cur.purpose === 'move' && !cur.moved && cur.ply === game.records.length;
      if (isAITurn() && !running) startSearch('move');
    }
    pump(dt);
    if (cur && cur.S.done && !cur.finished) { cur.finished = true; onSearchDone(); }
    if (cur && cur.finished && cur.purpose === 'move' && !cur.moved && !paused) {
      cur.hold -= dt;
      if (cur.hold <= 0 && !board.busy) {
        cur.moved = true;
        const m = cur.S.bestMove;
        if (m) doMove(m);
      }
    }
    drainEvents();
  }

  function onSearchDone() {
    const S = cur.S;
    const best = S.root.bestChild;
    const text = best ? san(best) : '–';
    log('dn', `✓ Done — best ${text} (${fmt(S.value)}) · ${S.nodes.toLocaleString()} positions · ${S.pruned.toLocaleString()} branches cut · ${Math.round(cur.computeMs)} ms compute`);
    if (!tree.selected) inspect(null);
    renderEvalBar();
  }

  function drainEvents() {
    if (!cur) return;
    const S = cur.S, ev = S.events;
    for (; cur.logIdx < ev.length; cur.logIdx++) {
      const e = ev[cur.logIdx];
      if (e.type === 'start') log('st', `▶ ${colorName(S.rootPos.turn)} searches ${S.depth} plies ahead · ${S.prune ? 'alpha-beta' : 'plain minimax'}${S.order ? ' + move ordering' : ''}`);
      else if (e.type === 'best' && e.node) log('best', `★ root best: ${S.sanOf(e.node)} = ${fmt(e.value)}`);
      else if (e.type === 'cut' && e.remaining > 0) {
        const nn = e.node, who = nn.ply === 0 ? 'root' : S.sanOf(nn);
        const how = nn.maximizing ? `α ${fmt(e.alpha)} ≥ β ${fmt(e.beta)}` : `α ${fmt(e.alpha)} ≥ β ${fmt(e.beta)}`;
        log('cut', `✂ ${who}: ${how} → ${e.remaining} move${e.remaining > 1 ? 's' : ''} pruned`);
      }
    }
  }

  function log(cls, text) {
    const box = $('log');
    const d = document.createElement('div'); d.className = cls; d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 120) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- render: side panels ---------- */
  function renderCaptured() {
    const by = [[], []], score = [0, 0];
    game.records.forEach(r => { if (r.victim) { by[r.color].push(r.victim); score[r.color] += PIECE_VAL[r.victim & 7]; } });
    [0, 1].forEach(c => {
      by[c].sort((a, b) => PIECE_VAL[b & 7] - PIECE_VAL[a & 7]);
      const adv = score[c] - score[c ^ 1];
      $(c ? 'capByBlack' : 'capByWhite').innerHTML = by[c].map(p => glyph(p)).join('') + (adv > 0 ? `<span class="adv">+${adv}</span>` : '');
    });
  }

  function renderHistory() {
    const h = $('hist'); let html = '';
    const recs = game.records;
    for (let i = 0; i < recs.length; i += 2) {
      const lastI = recs.length - 1;
      html += `<span class="no">${recs[i].moveNo}.</span><span class="${i === lastI ? 'last' : ''}">${esc(recs[i].san)}</span>`;
      html += recs[i + 1] ? `<span class="${i + 1 === lastI ? 'last' : ''}">${esc(recs[i + 1].san)}</span>` : '<span></span>';
    }
    h.innerHTML = html; h.scrollTop = h.scrollHeight;
    $('histCount').textContent = recs.length ? recs.length + ' plies' : '';
  }

  function renderEvalBar() {
    const v = EV.evaluate(game.pos);
    $('evalBar').querySelector('.fill').style.height = (50 + 50 * Math.tanh(v / 450)) + '%';
    $('evalNum').textContent = fmt(v);
  }

  function updateHud() {
    const S = cur && cur.S;
    const chip = $('hudState');
    if (!S) {
      chip.className = 'chip idle'; chip.textContent = 'idle';
      $('hudPlayer').textContent = gameOver ? 'Game over' : (isAITurn() ? 'AI to move' : 'Your move — the AI waits');
      ['stNodes', 'stPruned', 'stCuts', 'stTree'].forEach(i => $(i).textContent = '0');
      $('stDepth').textContent = settings.depth; $('stTime').textContent = '0.0s'; $('stNps').textContent = '–'; $('stBest').textContent = '–';
      return;
    }
    const running = !S.done;
    chip.className = 'chip ' + (S.done ? 'done' : paused ? 'pause' : 'run');
    chip.textContent = S.done ? 'done' : paused ? 'paused' : 'thinking';
    $('hudPlayer').textContent = `${colorName(cur.side)} · ${cur.purpose === 'hint' ? 'analysing (hint)' : 'AI'} · ${S.prune ? 'αβ' : 'minimax'}`;
    $('stDepth').textContent = S.depth + (S.recDepth < S.depth ? ` (tree ${S.recDepth})` : '');
    $('stNodes').textContent = S.nodes.toLocaleString();
    $('stPruned').textContent = S.pruned.toLocaleString();
    $('stCuts').textContent = S.cutoffs.toLocaleString();
    $('stTree').textContent = S.list.length.toLocaleString();
    $('stTime').textContent = (cur.thinkMs / 1000).toFixed(1) + 's';
    $('stNps').textContent = cur.computeMs > 5 ? Math.round(S.nodes / cur.computeMs) + 'k/s' : '–';
    const rb = S.root.bestChild;
    $('stBest').textContent = S.root.value != null && rb ? fmt(S.root.value) : '–';
  }

  function barPos(v) { return Math.max(0, Math.min(100, 50 + 50 * (Math.max(-500, Math.min(500, v)) / 500))); }

  function updateAB() {
    const S = tree.search;
    const box = $('abPath');
    if (!S) { box.innerHTML = '<div class="row head"><span></span><span>Start a search to see the window</span></div>'; $('abWho').textContent = ''; $('abGauge').style.opacity = .35; return; }
    $('abGauge').style.opacity = 1;
    const node = tree.hovered || tree.selected || S.current || S.root;
    const path = [];
    for (let n = node; n; n = n.parent) path.push(n);
    path.reverse();
    let html = '<div class="row head"><span></span><span>move</span><span>α</span><span>β</span><span>value</span></div>';
    path.forEach(n => {
      const live = n.state === ST.ACTIVE;
      const a = n.state === ST.DONE || n.state === ST.PRUNED ? n.alphaIn : n.alpha, b = n.state === ST.DONE || n.state === ST.PRUNED ? n.betaIn : n.beta;
      html += `<div class="row ${n === node ? 'cur' : ''}"><span>${n.ply}</span><span>${n.ply ? esc(S.sanOf(n)) : 'root'}${n.cutoff ? ' <span class="cut">✂</span>' : ''}</span>` +
        `<span class="a">${fmt(a)}</span><span class="b">${fmt(b)}</span><span>${n.value == null ? '…' : (n.bound || '') + fmt(n.value)}</span></div>`;
    });
    box.innerHTML = html;
    const a = node.state === ST.ACTIVE ? node.alpha : node.alphaIn, b = node.state === ST.ACTIVE ? node.beta : node.betaIn;
    const win = $('abGauge').querySelector('.win'), mv = $('abGauge').querySelector('.mk.v');
    const l = a <= -1e8 ? 0 : barPos(a), r = b >= 1e8 ? 100 : barPos(b);
    win.style.left = l + '%'; win.style.width = Math.max(0, r - l) + '%';
    if (node.value != null && Math.abs(node.value) < 1e8) { mv.style.display = 'block'; mv.style.left = barPos(node.value) + '%'; } else mv.style.display = 'none';
    $('abWho').textContent = node.ply ? `${S.sanOf(node)} · ${node.maximizing ? 'MAX' : 'MIN'}` : 'root · ' + (node.maximizing ? 'MAX' : 'MIN');
  }

  function updateCandidates() {
    const S = cur && cur.S;
    const tb = $('cand').querySelector('tbody');
    if (!S) { tb.innerHTML = '<tr><td class="nodes">No search yet</td></tr>'; return; }
    const kids = S.root.children.filter(c => c.state !== ST.PRUNED);
    const sgn = S.root.maximizing ? -1 : 1;
    kids.sort((a, b) => {
      const va = a.value == null ? 1e9 : sgn * a.value, vb = b.value == null ? 1e9 : sgn * b.value;
      return va - vb || a.slot - b.slot;
    });
    const sel = tree.selected;
    let html = '';
    for (const c of kids.slice(0, 40)) {
      const best = c === S.root.bestChild;
      html += `<tr data-id="${c.id}" class="${best ? 'best' : ''} ${c === sel ? 'sel' : ''}"><td>${best ? '★ ' : ''}${esc(S.sanOf(c))}</td>` +
        `<td class="barcell">${c.value != null ? `<div><i style="left:${barPos(c.value)}%"></i></div>` : ''}</td>` +
        `<td class="num">${c.state === ST.ACTIVE && c.value == null ? '…' : (c.bound || '') + fmt(c.value)}</td><td class="num nodes">${(c.state === ST.DONE ? c.subtree : S.nodes - c.nodes0).toLocaleString()}</td></tr>`;
    }
    if (tb._h !== html) { tb.innerHTML = html; tb._h = html; }
  }
  $('cand').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr || !tree.search) return;
    const n = tree.search.list[+tr.dataset.id];
    if (n) { tree.setSelected(n, true); tree.focusNode(n); }
  });

  /* ---------- node inspector ---------- */
  function miniBoard(pos, mv) {
    let h = '<div class="mini-board">';
    const from = mv ? CH.mFrom(mv) : -1, to = mv ? CH.mTo(mv) : -1;
    for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f, p = pos.board[sq];
      h += `<div class="${(r + f) % 2 === 0 ? 'd' : 'l'}${sq === from || sq === to ? ' m' : ''}">${p ? glyph(p) : ''}</div>`;
    }
    return h + '</div>';
  }

  function breakdown(out, base) {
    const scale = Math.max(150, ...EV.FACTORS.map(f => Math.abs(out[f[0]])));
    let h = '<table class="bd">';
    EV.FACTORS.forEach(([k, name, tip]) => {
      const v = out[k], w = Math.min(50, Math.abs(v) / scale * 50);
      const bar = v >= 0 ? `left:50%;width:${w}%;background:#35c8ff` : `left:${50 - w}%;width:${w}%;background:#b35cff`;
      const d = base ? out[k] - base[k] : null;
      h += `<tr title="${esc(tip)}"><td class="n">${name}</td><td style="width:80px"><div class="bar"><i style="${bar}"></i></div></td>` +
        `<td class="v ${signCls(v)}">${fmt(v)}</td>${base ? `<td class="d" title="change since the root position">${d === 0 ? '·' : (d > 0 ? '+' : '−') + Math.abs(d / 100).toFixed(2)}</td>` : ''}</tr>`;
    });
    h += `<tr class="tot"><td class="n">Static eval</td><td></td><td class="v ${signCls(out.total)}">${fmt(out.total)}</td>${base ? `<td class="d">${out.total - base.total === 0 ? '·' : (out.total - base.total > 0 ? '+' : '−') + Math.abs((out.total - base.total) / 100).toFixed(2)}</td>` : ''}</tr></table>`;
    return h;
  }

  function inspect(node) {
    const S = tree.search, box = $('insp');
    let viaPV = false;
    if (!node && S && cur && cur.S === S && S.done && !cur.moved && S.pv.length > 1) { node = S.pv[S.pv.length - 1]; viaPV = true; }
    if (!node || !S) {
      const out = {}; EV.evaluate(game.pos, out);
      $('inspWho').textContent = 'game position';
      box.innerHTML = `<div class="inspTop">${miniBoard(game.pos, game.records.length ? game.records[game.records.length - 1].m : 0)}<div class="kv">` +
        `<div><span>Side to move</span><br><b>${colorName(game.pos.turn)}</b></div><div><span>Phase</span><br><b>${Math.round(out.phase * 100)}% middlegame</b></div>` +
        `<div class="hint" style="margin:0">Click any node in the 3D tree to inspect the position it represents.</div></div></div>${breakdown(out, null)}` +
        `<p class="hint">Evaluation is from White's point of view (positive = good for White). Each row is one factor the search uses to score a position.</p>`;
      return;
    }
    const pos = S.positionAt(node), out = {};
    EV.evaluate(pos, out);
    const name = node.ply ? S.sanOf(node) : 'root';
    $('inspWho').textContent = viaPV ? 'end of best line' : node.ply ? `ply ${node.ply} · ${name}` : 'root';
    let msg = '';
    if (viaPV) msg += '<div class="msg" style="background:rgba(61,255,148,.1);border-color:rgba(61,255,148,.4)">The AI expects this position at the end of its best line. Compare it with the root to see <b>what the move gains</b>.</div>';
    if (node.state === ST.PRUNED) {
      const p = node.parent;
      msg = `<div class="msg pr">✂ <b>Pruned.</b> This move was never searched. At the parent the window had closed (α ${fmt(p.alpha)} ≥ β ${fmt(p.beta)}), so nothing below here can change the final decision.</div>`;
    } else if (node.state === ST.ACTIVE) msg = '<div class="msg">● Being searched right now — values below are still changing.</div>';
    if (node.cutoff) {
      const why = node.maximizing
        ? `This MAX node found a reply worth ${fmt(node.alpha)} ≥ β (${fmt(node.beta)}). The MIN player above already has something at least as good for them elsewhere, so they would never allow this line (beta cutoff).`
        : `This MIN node found a reply worth ${fmt(node.beta)} ≤ α (${fmt(node.alpha)}). The MAX player above can already guarantee more elsewhere, so they would never choose this line (alpha cutoff).`;
      msg += `<div class="msg cu">✂ <b>Cutoff:</b> ${node.prunedCount} remaining move${node.prunedCount === 1 ? '' : 's'} skipped. ${why}</div>`;
    }
    if (node.terminal) msg += `<div class="msg">${esc(node.terminal)}</div>`;
    if (node.pv && S.done) msg += '<div class="msg" style="background:rgba(61,255,148,.1);border-color:rgba(61,255,148,.4)">★ On the <b>best line</b> chosen by the search.</div>';
    const kv = node.state === ST.PRUNED
      ? `<div><span>Node type</span><br><b>${node.maximizing ? 'MAX' : 'MIN'} · ${colorName(pos.turn)} to move</b></div>`
      : `<div><span>Node type</span><br><b>${node.maximizing ? 'MAX (maximises)' : 'MIN (minimises)'}</b></div>` +
        `<div><span>Window in α / β</span><br><b><span class="pos">${fmt(node.alphaIn)}</span> / <span class="neg">${fmt(node.betaIn)}</span></b></div>` +
        `<div><span>Minimax value</span><br><b>${node.value == null ? '…' : (node.bound || '') + fmt(node.value)}</b>${node.bound ? ' <small style="color:var(--muted)">bound only</small>' : ''}</div>` +
        `<div><span>Positions below</span><br><b>${(node.state === ST.DONE ? node.subtree : S.nodes - node.nodes0).toLocaleString()}</b></div>`;
    $('insp').innerHTML = `<div class="line">${esc(S.lineText(node))}</div>${msg}<div class="inspTop">${miniBoard(pos, node.move)}<div class="kv">${kv}</div></div>` +
      `<div class="hint" style="margin:0 0 4px">Why this score? Static evaluation of the position (White's view) and its change since the root:</div>${breakdown(out, S.rootOut)}`;
  }

  function onTreeSelect(node) { inspect(node); updateAB(); arrowKey = ''; }

  function onTreeHover(node, mouse) {
    const tip = $('tip');
    const S = tree.search;
    if (!node || !mouse || !S) { tip.classList.add('hidden'); return; }
    const a = node.state === ST.DONE || node.state === ST.PRUNED ? node.alphaIn : node.alpha, b = node.state === ST.DONE || node.state === ST.PRUNED ? node.betaIn : node.beta;
    tip.innerHTML = node.ply === 0 ? `<b>Root</b> · ${node.maximizing ? 'MAX' : 'MIN'}<br><span class="k">current game position</span>` :
      `<b>${esc(S.lineText(node))}</b><br><span class="k">${node.maximizing ? 'MAX' : 'MIN'} · ply ${node.ply}</span>` +
      (node.state === ST.PRUNED ? '<br><span style="color:#ff6b7d">pruned — never searched</span>' :
        `<br><span class="k">α</span> <span class="mono">${fmt(a)}</span> <span class="k">β</span> <span class="mono">${fmt(b)}</span><br><span class="k">value</span> <span class="mono">${node.value == null ? '…' : (node.bound || '') + fmt(node.value)}</span>` +
        (node.cutoff ? `<br><span style="color:#ff9a4a">✂ cut ${node.prunedCount} moves</span>` : ''));
    tip.classList.remove('hidden');
    const pane = $('treePane').getBoundingClientRect();
    let x = mouse.cx - pane.left + 16, y = mouse.cy - pane.top + 16;
    x = Math.min(x, pane.width - 290); y = Math.min(y, pane.height - tip.offsetHeight - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  /* ---------- board arrows for the line being examined ---------- */
  function updateArrows() {
    const S = tree.search;
    let node = tree.hovered || tree.selected || null;
    if (!node && cur && S === cur.S) {
      if (!S.done) node = S.current;
      else if (!cur.moved) node = S.pv.length ? S.pv[S.pv.length - 1] : null;
    }
    const key = settings.arrows && node && S ? cur && cur.id + ':' + node.id : '';
    if (key === arrowKey) return;
    arrowKey = key;
    if (!key) { board.setArrows([]); return; }
    const list = [];
    for (let n = node; n && n.parent; n = n.parent) list.push({ from: CH.mFrom(n.move), to: CH.mTo(n.move), color: LINE_COLORS[Math.min(n.ply, 6)], opacity: n === node ? 0.95 : 0.8 });
    list.reverse();
    board.setArrows(list);
  }

  /* ---------- UI wiring ---------- */
  $('btnNew').onclick = newGame;
  $('bannerBtn').onclick = newGame;
  $('btnUndo').onclick = undo;
  $('btnPause').onclick = () => { paused = !paused; updateButtons(); };
  $('btnStep').onclick = () => { stepReq = true; };
  $('btnHint').onclick = () => {
    if (gameOver || isAITurn()) return;
    cur = null; startSearch('hint'); paused = false; updateButtons();
  };
  $('btnFlip').onclick = () => { flipped = !flipped; board.setPerspective(flipped ? !(humanColor() === 1) : humanColor() === 1); };
  $('btnFit').onclick = () => { tree.autoFit = true; tree.fit(0.8); };
  $('btnAuto').onclick = e => { tree.ctl.autoRotate = !tree.ctl.autoRotate; e.currentTarget.classList.toggle('on', tree.ctl.autoRotate); };
  const LABEL_TXT = ['Labels: off', 'Labels: moves', 'Labels: more'];
  $('btnLabels').onclick = e => { tree.labelMode = (tree.labelMode + 1) % 3; e.currentTarget.textContent = LABEL_TXT[tree.labelMode]; };
  $('mode').onchange = e => { settings.mode = e.target.value; flipped = false; newGame(); };
  $('depth').onchange = e => { settings.depth = +e.target.value; restartIfRunning(); };
  $('treeDepth').onchange = e => { settings.treeDepth = +e.target.value; restartIfRunning(); };
  $('optPrune').onchange = e => { settings.prune = e.target.checked; restartIfRunning(); };
  $('optOrder').onchange = e => { settings.order = e.target.checked; restartIfRunning(); };
  $('optAB').onchange = e => { tree.showAB = e.target.checked; };
  $('optRings').onchange = e => { tree.showRings = e.target.checked; tree.updateRingTransforms(); };
  $('optArrows').onchange = e => { settings.arrows = e.target.checked; arrowKey = '#'; };
  $('speed').oninput = e => { settings.speed = +e.target.value; $('speedOut').textContent = RATE_TXT[settings.speed - 1]; };
  $('speed').value = settings.speed; $('speedOut').textContent = RATE_TXT[settings.speed - 1];
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); paused = !paused; updateButtons(); }
    else if (e.key === 'u' || e.key === 'U') undo();
    else if (e.key === 'n' || e.key === 'N') newGame();
    else if (e.key === 'f' || e.key === 'F') { tree.autoFit = true; tree.fit(0.8); }
    else if (e.key === 's' || e.key === 'S') { if (paused) stepReq = true; }
  });

  /* ---------- main loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    try {
      tick(dt);
      board.render(dt);
      tree.update(dt);
      updateArrows();
      hudT += dt;
      if (hudT > 0.12) {
        hudT = 0; updateHud(); updateAB(); updateCandidates(); updateButtons();
        inspT += 0.12;
        if (inspT > 0.5 && tree.selected && tree.search && !tree.search.done) { inspT = 0; inspect(tree.selected); }
      }
    } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }

  board.setPosition(game.pos);
  refreshAll();
  inspect(null);
  log('st', 'Ready. You play White — click a piece, then a highlighted square.');
  requestAnimationFrame(frame);

  G.__chess = { game, board, tree, get cur() { return cur; }, settings, newGame, doMove };
})(window);

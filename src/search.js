/* Minimax search with alpha-beta pruning, written as a resumable generator so the UI can animate it.
   The top `recDepth` plies are recorded as a tree (TNode); deeper plies run as a fast plain search. */
(function (G) {
  'use strict';
  const CH = G.CH, EV = G.EV;
  const { P, F_CAP, F_EP } = CH;
  const INF = 1e9, MATE = EV.MATE, QMAX = 6;
  const ST = { PENDING: 0, ACTIVE: 1, DONE: 2, PRUNED: 3 };
  const ORDER_VAL = [0, 1, 3, 3, 5, 9, 0];

  class TNode {
    constructor(id, parent, move, slot, ply) {
      this.id = id; this.parent = parent; this.move = move; this.slot = slot; this.ply = ply;
      this.children = [];
      this.maximizing = true;
      this.state = ST.ACTIVE;
      this.alphaIn = -INF; this.betaIn = INF; this.alpha = -INF; this.beta = INF;
      this.value = null; this.bound = '';
      this.bestChild = null; this.bestMove = 0;
      this.cutoff = false; this.prunedCount = 0; this.nMoves = 0;
      this.subtree = 0; this.nodes0 = 0;
      this.terminal = '';
      this.pv = false;
      this.san = null;
      // visual state (owned by the tree view)
      this.x = 0; this.y = 0; this.z = 0; this.tx = 0; this.ty = 0; this.tz = 0;
      this.w = 1; this.a0 = 0; this.a1 = 0; this.appear = 0; this.inst = -1;
    }
  }

  class Search {
    /**
     * @param {Position} pos     root position (cloned)
     * @param {object} o         {depth, treeDepth, prune, order, cap}
     */
    constructor(pos, o) {
      this.rootPos = pos.clone();
      this.pos = pos.clone();
      this.depth = o.depth;
      this.recDepth = Math.max(1, Math.min(o.depth, o.treeDepth || 3));
      this.prune = o.prune !== false;
      this.order = o.order !== false;
      this.cap = o.cap || 6000;
      this.list = [];
      this.events = [];
      this.dirty = new Set();
      this.nodes = 0; this.qnodes = 0; this.cutoffs = 0; this.pruned = 0; this.maxPly = 0;
      this.killers = [];
      for (let i = 0; i < 64; i++) this.killers.push([0, 0]);
      this.done = false; this.current = null; this.root = null;
      this.bestMove = 0; this.value = 0; this.pv = [];
      this.iter = this.run();
    }

    newNode(parent, move, slot, state) {
      const n = new TNode(this.list.length, parent, move, slot, parent ? parent.ply + 1 : 0);
      n.state = state;
      this.list.push(n);
      if (parent) parent.children.push(n);
      this.dirty.add(n);
      return n;
    }

    /** Advance the search by one visible step. Returns false when finished. */
    step() {
      if (this.done) return false;
      const r = this.iter.next();
      if (r.done) { this.done = true; this.finish(); return false; }
      return true;
    }

    finish() {
      const pv = [];
      let n = this.root;
      while (n) { n.pv = true; pv.push(n); this.dirty.add(n); n = n.bestChild; }
      this.pv = pv;
      this.current = null;
      this.events.push({ type: 'done' });
    }

    scoreMove(m, ply) {
      const b = this.pos.board, from = m & 127, to = (m >> 7) & 127, fl = (m >> 14) & 15, promo = (m >> 18) & 7;
      const pt = b[from] & 7;
      let s = 0;
      if (fl & F_CAP) s = 100000 + ORDER_VAL[(fl & F_EP) ? P : (b[to] & 7)] * 16 - pt;
      if (promo) s += 90000 + promo * 10;
      if (!(fl & F_CAP) && !promo) {
        const k = this.killers[ply];
        if (k && (k[0] === m || k[1] === m)) s = 5000;
        else s = EV.pstDelta(b[from], from, to);
      }
      return s;
    }

    pick(moves, scores, i) {
      let bi = i, bs = scores[i];
      for (let j = i + 1; j < moves.length; j++) if (scores[j] > bs) { bs = scores[j]; bi = j; }
      if (bi !== i) {
        const tm = moves[i]; moves[i] = moves[bi]; moves[bi] = tm;
        const ts = scores[i]; scores[i] = scores[bi]; scores[bi] = ts;
      }
      return moves[i];
    }

    *run() {
      const pos = this.pos;
      const root = this.root = this.newNode(null, 0, 0, ST.ACTIVE);
      root.maximizing = pos.turn === 0;
      this.current = root;
      this.events.push({ type: 'start', node: root });
      yield;
      this.value = yield* this.rec(root, this.depth, -INF, INF);
      root.value = this.value;
      root.state = ST.DONE;
      root.subtree = this.nodes;
      this.bestMove = root.bestMove;
    }

    /** Recorded interior node. Position `this.pos` is already at the node. */
    *rec(node, depth, alpha, beta) {
      const pos = this.pos, maxi = pos.turn === 0, us = pos.turn;
      node.maximizing = maxi;
      this.nodes++;
      if (node.ply > this.maxPly) this.maxPly = node.ply;
      const moves = pos.legalMoves();
      const n = moves.length;
      node.nMoves = n;
      if (!n) {
        node.terminal = pos.inCheck() ? 'Checkmate' : 'Stalemate';
        return pos.inCheck() ? (maxi ? -MATE + node.ply : MATE - node.ply) : 0;
      }
      if (pos.half >= 100) { node.terminal = 'Fifty-move draw'; return 0; }

      const scores = new Array(n);
      for (let i = 0; i < n; i++) {
        scores[i] = this.order ? this.scoreMove(moves[i], node.ply) : 0;
        if (this.order && node.ply === 0 && scores[i] < 5000) scores[i] += Math.random() * 3;
      }
      let best = maxi ? -INF : INF;
      for (let i = 0; i < n; i++) {
        const m = this.order ? this.pick(moves, scores, i) : moves[i];
        let child = null;
        if (this.list.length < this.cap) {
          child = this.newNode(node, m, i, ST.ACTIVE);
          child.maximizing = pos.turn ^ 1 ? false : true;
          child.alphaIn = alpha; child.betaIn = beta; child.alpha = alpha; child.beta = beta;
          child.nodes0 = this.nodes;
          this.current = child;
          this.events.push({ type: 'enter', node: child });
          yield;
        }
        pos.make(m);
        const cd = depth - 1;
        let v;
        if (child && cd > 0 && child.ply < this.recDepth) v = yield* this.rec(child, cd, alpha, beta);
        else v = this.plain(cd, alpha, beta, node.ply + 1);
        pos.unmake(m);

        if (child) {
          child.value = v; child.state = ST.DONE;
          child.subtree = this.nodes - child.nodes0;
          if (this.prune) child.bound = v <= child.alphaIn ? '≤' : v >= child.betaIn ? '≥' : '';
          this.dirty.add(child);
          this.current = node;
        }
        if (maxi) {
          if (v > best) { best = v; this.setBest(node, child, m, v); }
          if (v > alpha) alpha = v;
        } else {
          if (v < best) { best = v; this.setBest(node, child, m, v); }
          if (v < beta) beta = v;
        }
        node.alpha = alpha; node.beta = beta; node.value = best;
        this.dirty.add(node);

        if (this.prune && alpha >= beta) {
          node.cutoff = true;
          const remaining = n - i - 1;
          node.prunedCount = remaining;
          this.pruned += remaining; this.cutoffs++;
          for (let j = i + 1; j < n && this.list.length < this.cap; j++) {
            const g = this.newNode(node, moves[j], j, ST.PRUNED);
            g.maximizing = !node.maximizing;
          }
          this.events.push({ type: 'cut', node, remaining, alpha, beta, atMove: child });
          if (remaining > 0) yield;
          break;
        }
      }
      return best;
    }

    setBest(node, child, m, v) {
      if (node.bestChild) this.dirty.add(node.bestChild);
      node.bestChild = child; node.bestMove = m;
      if (child) this.dirty.add(child);
      if (node.ply === 0) this.events.push({ type: 'best', node: child, move: m, value: v });
    }

    /** Fast, non-recorded alpha-beta below the recorded part of the tree. */
    plain(depth, alpha, beta, ply) {
      if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);
      this.nodes++;
      if (ply > this.maxPly) this.maxPly = ply;
      const pos = this.pos;
      if (pos.half >= 100) return 0;
      const maxi = pos.turn === 0, us = pos.turn;
      const moves = pos.gen(false), n = moves.length;
      const scores = new Array(n);
      for (let i = 0; i < n; i++) scores[i] = this.order ? this.scoreMove(moves[i], ply) : 0;
      let best = maxi ? -INF : INF, legal = 0;
      for (let i = 0; i < n; i++) {
        const m = this.order ? this.pick(moves, scores, i) : moves[i];
        pos.make(m);
        if (pos.isAttacked(pos.kings[us], us ^ 1)) { pos.unmake(m); continue; }
        legal++;
        const v = this.plain(depth - 1, alpha, beta, ply + 1);
        pos.unmake(m);
        if (maxi) { if (v > best) best = v; if (v > alpha) alpha = v; }
        else { if (v < best) best = v; if (v < beta) beta = v; }
        if (this.prune && alpha >= beta) {
          this.cutoffs++; this.pruned += n - i - 1;
          if (!(m & (F_CAP << 14)) && !((m >> 18) & 7)) {
            const k = this.killers[ply];
            if (k && k[0] !== m) { k[1] = k[0]; k[0] = m; }
          }
          break;
        }
      }
      if (!legal) return pos.inCheck() ? (maxi ? -MATE + ply : MATE - ply) : 0;
      return best;
    }

    /** Quiescence: keep resolving captures so we never evaluate in the middle of an exchange. */
    quiesce(alpha, beta, ply, qd) {
      this.nodes++; this.qnodes++;
      if (ply > this.maxPly) this.maxPly = ply;
      const pos = this.pos, maxi = pos.turn === 0, us = pos.turn;
      const inChk = pos.inCheck();
      let best;
      if (!inChk) {
        best = EV.evaluate(pos);
        if (maxi) { if (best >= beta) return best; if (best > alpha) alpha = best; }
        else { if (best <= alpha) return best; if (best < beta) beta = best; }
        if (qd >= QMAX) return best;
      } else {
        if (qd >= QMAX) return EV.evaluate(pos);
        best = maxi ? -MATE + ply : MATE - ply;
      }
      const moves = pos.gen(!inChk), n = moves.length;
      const scores = new Array(n);
      for (let i = 0; i < n; i++) scores[i] = this.order ? this.scoreMove(moves[i], 63) : 0;
      for (let i = 0; i < n; i++) {
        const m = this.pick(moves, scores, i);
        pos.make(m);
        if (pos.isAttacked(pos.kings[us], us ^ 1)) { pos.unmake(m); continue; }
        const v = this.quiesce(alpha, beta, ply + 1, qd + 1);
        pos.unmake(m);
        if (maxi) { if (v > best) best = v; if (v > alpha) alpha = v; }
        else { if (v < best) best = v; if (v < beta) beta = v; }
        if (alpha >= beta) break;
      }
      return best;
    }

    /** Position reached at a tree node (fresh clone). */
    positionAt(node) {
      const path = [];
      for (let n = node; n && n.parent; n = n.parent) path.push(n.move);
      const p = this.rootPos.clone();
      for (let i = path.length - 1; i >= 0; i--) p.make(path[i]);
      return p;
    }

    sanOf(node) {
      if (!node.parent) return 'root';
      if (node.san) return node.san;
      const p = this.positionAt(node.parent);
      node.san = p.san(node.move);
      return node.san;
    }

    /** Move sequence text from the root to a node, e.g. "1.e4 e5 2.Nf3". */
    lineText(node) {
      const path = [];
      for (let n = node; n && n.parent; n = n.parent) path.push(n);
      path.reverse();
      let s = '';
      const first = this.rootPos;
      let num = first.full, black = first.turn === 1;
      path.forEach((n, i) => {
        if (!black) s += (s ? ' ' : '') + num + '.' + this.sanOf(n);
        else s += (s && i ? ' ' : '') + (i === 0 ? num + '...' : '') + this.sanOf(n);
        if (black) num++;
        black = !black;
      });
      return s || '(root position)';
    }
  }

  G.SR = { Search, TNode, ST, INF, MATE };
})(window);

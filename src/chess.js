/* Chess rules engine: 0x88 board, legal move generation, make/unmake, SAN, draw detection. */
(function (G) {
  'use strict';
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const WHITE = 0, BLACK = 1;
  const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
  const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
  const K_OFF = [1, -1, 16, -16, 17, 15, -17, -15];
  const B_OFF = [17, 15, -17, -15];
  const R_OFF = [1, -1, 16, -16];
  const CM = new Uint8Array(128).fill(15);
  CM[0] = 13; CM[7] = 14; CM[4] = 12; CM[112] = 7; CM[119] = 11; CM[116] = 3;
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const LETTERS = ' PNBRQK';

  const mFrom = m => m & 127;
  const mTo = m => (m >> 7) & 127;
  const mFlags = m => (m >> 14) & 15;
  const mPromo = m => (m >> 18) & 7;
  const mk = (from, to, flags, promo) => from | (to << 7) | ((flags | 0) << 14) | ((promo | 0) << 18);
  const sqName = sq => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
  const nameSq = s => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 16;
  const uci = m => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? 'nbrq'[mPromo(m) - 2] : '');
  const colorOf = p => p >> 3;
  const typeOf = p => p & 7;
  const pieceChar = p => { const c = LETTERS[p & 7]; return (p >> 3) ? c.toLowerCase() : c; };

  class Position {
    constructor() {
      this.board = new Int8Array(128);
      this.turn = WHITE; this.castling = 0; this.ep = -1; this.half = 0; this.full = 1;
      this.kings = [4, 116];
      this.sp = 0;
      this.stCap = new Int8Array(4096); this.stCastle = new Uint8Array(4096);
      this.stEp = new Int16Array(4096); this.stHalf = new Int16Array(4096);
    }

    load(fen) {
      const parts = fen.trim().split(/\s+/);
      this.board.fill(0);
      let r = 7, f = 0;
      for (const ch of parts[0]) {
        if (ch === '/') { r--; f = 0; }
        else if (ch >= '1' && ch <= '8') f += +ch;
        else {
          const lower = ch.toLowerCase();
          const t = LETTERS.indexOf(lower.toUpperCase());
          const color = ch === lower ? BLACK : WHITE;
          const sq = r * 16 + f;
          this.board[sq] = t | (color << 3);
          if (t === K) this.kings[color] = sq;
          f++;
        }
      }
      this.turn = (parts[1] || 'w') === 'w' ? WHITE : BLACK;
      this.castling = 0;
      const c = parts[2] || '-';
      if (c.includes('K')) this.castling |= 1;
      if (c.includes('Q')) this.castling |= 2;
      if (c.includes('k')) this.castling |= 4;
      if (c.includes('q')) this.castling |= 8;
      this.ep = parts[3] && parts[3] !== '-' ? nameSq(parts[3]) : -1;
      this.half = +(parts[4] || 0);
      this.full = +(parts[5] || 1);
      this.sp = 0;
      return this;
    }

    toFEN() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let e = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 16 + f];
          if (!p) e++; else { if (e) { s += e; e = 0; } s += pieceChar(p); }
        }
        if (e) s += e;
        if (r) s += '/';
      }
      const c = (this.castling & 1 ? 'K' : '') + (this.castling & 2 ? 'Q' : '') + (this.castling & 4 ? 'k' : '') + (this.castling & 8 ? 'q' : '');
      return `${s} ${this.turn ? 'b' : 'w'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    }

    clone() {
      const p = new Position();
      p.board.set(this.board);
      p.turn = this.turn; p.castling = this.castling; p.ep = this.ep;
      p.half = this.half; p.full = this.full; p.kings = this.kings.slice();
      return p;
    }

    isAttacked(sq, by) {
      const b = this.board;
      let s = by ? sq + 15 : sq - 15;
      if (!(s & 0x88) && b[s] === (P | (by << 3))) return true;
      s = by ? sq + 17 : sq - 17;
      if (!(s & 0x88) && b[s] === (P | (by << 3))) return true;
      const kn = N | (by << 3), kg = K | (by << 3);
      for (let i = 0; i < 8; i++) {
        s = sq + N_OFF[i]; if (!(s & 0x88) && b[s] === kn) return true;
        s = sq + K_OFF[i]; if (!(s & 0x88) && b[s] === kg) return true;
      }
      for (let i = 0; i < 4; i++) {
        let o = B_OFF[i];
        s = sq + o;
        while (!(s & 0x88)) {
          const q = b[s];
          if (q) { if ((q >> 3) === by && ((q & 7) === B || (q & 7) === Q)) return true; break; }
          s += o;
        }
        o = R_OFF[i]; s = sq + o;
        while (!(s & 0x88)) {
          const q = b[s];
          if (q) { if ((q >> 3) === by && ((q & 7) === R || (q & 7) === Q)) return true; break; }
          s += o;
        }
      }
      return false;
    }

    inCheck() { return this.isAttacked(this.kings[this.turn], this.turn ^ 1); }

    /** Pseudo-legal moves (captures + promotions only when capsOnly). */
    gen(capsOnly) {
      const b = this.board, us = this.turn, them = us ^ 1, out = [];
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (p === 0 || (p >> 3) !== us) continue;
        const t = p & 7;
        if (t === P) {
          const dir = us ? -16 : 16, r = sq >> 4;
          const startR = us ? 6 : 1, promoR = us ? 1 : 6;
          let to = sq + dir;
          if (!(to & 0x88) && !b[to]) {
            if (r === promoR) {
              if (capsOnly) out.push(sq | (to << 7) | (Q << 18));
              else for (let pr = Q; pr >= N; pr--) out.push(sq | (to << 7) | (pr << 18));
            } else if (!capsOnly) {
              out.push(sq | (to << 7));
              if (r === startR && !b[to + dir]) out.push(sq | ((to + dir) << 7) | (F_DOUBLE << 14));
            }
          }
          for (let d = -1; d <= 1; d += 2) {
            to = sq + dir + d;
            if (to & 0x88) continue;
            const q = b[to];
            if (q && (q >> 3) === them) {
              if (r === promoR) {
                if (capsOnly) out.push(sq | (to << 7) | (F_CAP << 14) | (Q << 18));
                else for (let pr = Q; pr >= N; pr--) out.push(sq | (to << 7) | (F_CAP << 14) | (pr << 18));
              } else out.push(sq | (to << 7) | (F_CAP << 14));
            } else if (to === this.ep && !q) out.push(sq | (to << 7) | ((F_CAP | F_EP) << 14));
          }
        } else if (t === N || t === K) {
          const offs = t === N ? N_OFF : K_OFF;
          for (let i = 0; i < 8; i++) {
            const to = sq + offs[i];
            if (to & 0x88) continue;
            const q = b[to];
            if (q === 0) { if (!capsOnly) out.push(sq | (to << 7)); }
            else if ((q >> 3) === them) out.push(sq | (to << 7) | (F_CAP << 14));
          }
        } else {
          const offs = t === B ? B_OFF : t === R ? R_OFF : K_OFF;
          for (let i = 0; i < offs.length; i++) {
            const o = offs[i];
            let to = sq + o;
            while (!(to & 0x88)) {
              const q = b[to];
              if (q === 0) { if (!capsOnly) out.push(sq | (to << 7)); }
              else { if ((q >> 3) === them) out.push(sq | (to << 7) | (F_CAP << 14)); break; }
              to += o;
            }
          }
        }
      }
      if (!capsOnly) {
        if (us === WHITE) {
          if ((this.castling & 1) && b[4] === (K) && b[7] === (R) && !b[5] && !b[6] &&
              !this.isAttacked(4, 1) && !this.isAttacked(5, 1) && !this.isAttacked(6, 1)) out.push(4 | (6 << 7) | (F_CASTLE << 14));
          if ((this.castling & 2) && b[4] === (K) && b[0] === (R) && !b[1] && !b[2] && !b[3] &&
              !this.isAttacked(4, 1) && !this.isAttacked(3, 1) && !this.isAttacked(2, 1)) out.push(4 | (2 << 7) | (F_CASTLE << 14));
        } else {
          const kk = K | 8, rr = R | 8;
          if ((this.castling & 4) && b[116] === kk && b[119] === rr && !b[117] && !b[118] &&
              !this.isAttacked(116, 0) && !this.isAttacked(117, 0) && !this.isAttacked(118, 0)) out.push(116 | (118 << 7) | (F_CASTLE << 14));
          if ((this.castling & 8) && b[116] === kk && b[112] === rr && !b[113] && !b[114] && !b[115] &&
              !this.isAttacked(116, 0) && !this.isAttacked(115, 0) && !this.isAttacked(114, 0)) out.push(116 | (114 << 7) | (F_CASTLE << 14));
        }
      }
      return out;
    }

    legalMoves() {
      const moves = this.gen(false), us = this.turn, out = [];
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        this.make(m);
        if (!this.isAttacked(this.kings[us], us ^ 1)) out.push(m);
        this.unmake(m);
      }
      return out;
    }

    hasLegalMove() {
      const moves = this.gen(false), us = this.turn;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        this.make(m);
        const ok = !this.isAttacked(this.kings[us], us ^ 1);
        this.unmake(m);
        if (ok) return true;
      }
      return false;
    }

    make(m) {
      const from = m & 127, to = (m >> 7) & 127, fl = (m >> 14) & 15, promo = (m >> 18) & 7;
      const b = this.board, p = b[from], us = this.turn, sp = this.sp++;
      this.stCap[sp] = b[to]; this.stCastle[sp] = this.castling; this.stEp[sp] = this.ep; this.stHalf[sp] = this.half;
      b[to] = p; b[from] = 0;
      if (fl & F_EP) { const cs = to + (us ? 16 : -16); this.stCap[sp] = b[cs]; b[cs] = 0; }
      if (promo) b[to] = promo | (us << 3);
      if (fl & F_CASTLE) {
        if (to > from) { b[from + 1] = b[to + 1]; b[to + 1] = 0; }
        else { b[from - 1] = b[to - 2]; b[to - 2] = 0; }
      }
      if ((p & 7) === K) this.kings[us] = to;
      this.castling &= CM[from] & CM[to];
      this.ep = (fl & F_DOUBLE) ? (from + to) >> 1 : -1;
      this.half = ((p & 7) === P || this.stCap[sp]) ? 0 : this.half + 1;
      if (us) this.full++;
      this.turn = us ^ 1;
    }

    unmake(m) {
      const from = m & 127, to = (m >> 7) & 127, fl = (m >> 14) & 15, promo = (m >> 18) & 7;
      const b = this.board, sp = --this.sp;
      this.turn ^= 1;
      const us = this.turn;
      if (us) this.full--;
      let p = b[to];
      if (promo) p = P | (us << 3);
      b[from] = p;
      if (fl & F_EP) { b[to] = 0; b[to + (us ? 16 : -16)] = this.stCap[sp]; }
      else b[to] = this.stCap[sp];
      if (fl & F_CASTLE) {
        if (to > from) { b[to + 1] = b[from + 1]; b[from + 1] = 0; }
        else { b[to - 2] = b[from - 1]; b[from - 1] = 0; }
      }
      if ((p & 7) === K) this.kings[us] = from;
      this.castling = this.stCastle[sp]; this.ep = this.stEp[sp]; this.half = this.stHalf[sp];
    }

    /** Piece captured by move m (works before the move is made). */
    victim(m) {
      const fl = (m >> 14) & 15;
      if (fl & F_EP) return P | ((this.turn ^ 1) << 3);
      return this.board[(m >> 7) & 127];
    }

    insufficientMaterial() {
      const b = this.board;
      const minors = [];
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = b[sq] & 7;
        if (!t || t === K) continue;
        if (t === N || t === B) minors.push([t, sq]); else return false;
      }
      if (minors.length <= 1) return true;
      if (minors.every(x => x[0] === B)) {
        const c0 = ((minors[0][1] >> 4) + (minors[0][1] & 7)) & 1;
        return minors.every(x => (((x[1] >> 4) + (x[1] & 7)) & 1) === c0);
      }
      return false;
    }

    key() {
      let s = '';
      const b = this.board;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        s += String.fromCharCode(48 + b[sq]);
      }
      let ep = '-';
      if (this.ep >= 0) {
        const pawn = P | (this.turn << 3), d = this.turn ? 16 : -16;
        const a = this.ep + d - 1, c = this.ep + d + 1;
        if ((!(a & 0x88) && b[a] === pawn) || (!(c & 0x88) && b[c] === pawn)) ep = this.ep;
      }
      return s + this.turn + this.castling + ep;
    }

    san(m, legal) {
      const from = mFrom(m), to = mTo(m), fl = mFlags(m), promo = mPromo(m);
      const p = this.board[from], t = p & 7;
      let s;
      if (fl & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
      else {
        s = '';
        if (t === P) {
          if (fl & F_CAP) s += 'abcdefgh'[from & 7] + 'x';
        } else {
          s += LETTERS[t];
          legal = legal || this.legalMoves();
          const others = legal.filter(x => x !== m && mTo(x) === to && (this.board[mFrom(x)] & 7) === t);
          if (others.length) {
            const sameFile = others.some(x => (mFrom(x) & 7) === (from & 7));
            const sameRank = others.some(x => (mFrom(x) >> 4) === (from >> 4));
            if (!sameFile) s += 'abcdefgh'[from & 7];
            else if (!sameRank) s += (from >> 4) + 1;
            else s += sqName(from);
          }
          if (fl & F_CAP) s += 'x';
        }
        s += sqName(to);
        if (promo) s += '=' + LETTERS[promo];
      }
      this.make(m);
      if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
      this.unmake(m);
      return s;
    }

    perft(d) {
      if (d === 0) return 1;
      const moves = this.legalMoves();
      if (d === 1) return moves.length;
      let n = 0;
      for (const m of moves) { this.make(m); n += this.perft(d - 1); this.unmake(m); }
      return n;
    }
  }

  /** A game: position + history + draw/mate detection. */
  class Game {
    constructor() { this.reset(); }
    reset(fen) {
      this.pos = new Position().load(fen || START_FEN);
      this.startFen = this.pos.toFEN();
      this.records = [];
      this.keys = [this.pos.key()];
    }
    legal() { return this.pos.legalMoves(); }
    play(m) {
      const legal = this.pos.legalMoves();
      const piece = this.pos.board[mFrom(m)];
      const victim = this.pos.victim(m);
      const san = this.pos.san(m, legal);
      const moveNo = this.pos.full, color = this.pos.turn;
      this.pos.make(m);
      this.keys.push(this.pos.key());
      this.records.push({ m, san, piece, victim, moveNo, color });
    }
    undo() {
      const r = this.records.pop();
      if (!r) return null;
      this.keys.pop();
      this.pos.unmake(r.m);
      return r;
    }
    status() {
      const pos = this.pos;
      const check = pos.inCheck();
      if (!pos.hasLegalMove()) {
        if (check) return { over: true, check, winner: pos.turn ^ 1, result: pos.turn ? '1-0' : '0-1', reason: 'Checkmate' };
        return { over: true, check, winner: -1, result: '1/2-1/2', reason: 'Stalemate' };
      }
      if (pos.insufficientMaterial()) return { over: true, check, winner: -1, result: '1/2-1/2', reason: 'Insufficient material' };
      if (pos.half >= 100) return { over: true, check, winner: -1, result: '1/2-1/2', reason: 'Fifty-move rule' };
      const k = this.keys[this.keys.length - 1];
      let n = 0;
      for (const x of this.keys) if (x === k) n++;
      if (n >= 3) return { over: true, check, winner: -1, result: '1/2-1/2', reason: 'Threefold repetition' };
      return { over: false, check };
    }
  }

  G.CH = {
    P, N, B, R, Q, K, WHITE, BLACK, F_CAP, F_EP, F_CASTLE, F_DOUBLE, START_FEN, LETTERS,
    mFrom, mTo, mFlags, mPromo, mk, sqName, nameSq, uci, colorOf, typeOf, pieceChar,
    Position, Game
  };
})(window);

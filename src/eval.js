/* Static evaluation (centipawns, White's point of view) with a per-factor breakdown. */
(function (G) {
  'use strict';
  const { P, N, B, R, Q, K } = G.CH;
  const VAL = [0, 100, 320, 330, 500, 900, 0];
  const MATE = 30000;

  const PST = [null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  ];
  const KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

  // index into the 64-entry tables from a 0x88 square, from each side's point of view
  const IDX = [new Int16Array(128), new Int16Array(128)];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const r = sq >> 4, f = sq & 7;
    IDX[0][sq] = (7 - r) * 8 + f;
    IDX[1][sq] = r * 8 + f;
  }

  const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
  const K_OFF = [1, -1, 16, -16, 17, 15, -17, -15];
  const B_OFF = [17, 15, -17, -15];
  const R_OFF = [1, -1, 16, -16];
  const PASSED = [0, 5, 10, 20, 35, 60, 100, 0];

  const pawnCnt = [new Int8Array(10), new Int8Array(10)];
  const pawnMax = [new Int8Array(10), new Int8Array(10)]; // most advanced pawn per file (relative rank), -1 none
  const pawnMin = [new Int8Array(10), new Int8Array(10)]; // least advanced pawn per file (relative rank), 9 none

  function slide(b, sq, offs, own) {
    let c = 0;
    for (let i = 0; i < offs.length; i++) {
      const o = offs[i];
      let s = sq + o;
      while (!(s & 0x88)) {
        const q = b[s];
        if (q) { if ((q >> 3) !== own) c++; break; }
        c++; s += o;
      }
    }
    return c;
  }

  /** Static evaluation; `out` (optional) receives the per-factor breakdown (White minus Black). */
  function evaluate(pos, out) {
    const b = pos.board;
    let material = 0, position = 0, mobility = 0, pawns = 0, bishopPair = 0, rooks = 0, kingSafety = 0, kingMg = 0, kingEg = 0;
    let npm = 0;
    const bishops = [0, 0];
    for (let c = 0; c < 2; c++) { pawnCnt[c].fill(0); pawnMax[c].fill(-1); pawnMin[c].fill(9); }

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if ((p & 7) !== P) continue;
      const c = p >> 3, f = (sq & 7) + 1, rr = c ? 7 - (sq >> 4) : (sq >> 4);
      pawnCnt[c][f]++;
      if (rr > pawnMax[c][f]) pawnMax[c][f] = rr;
      if (rr < pawnMin[c][f]) pawnMin[c][f] = rr;
    }

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p) continue;
      const c = p >> 3, t = p & 7, sgn = c ? -1 : 1, f = (sq & 7) + 1, idx = IDX[c][sq];
      const rr = c ? 7 - (sq >> 4) : (sq >> 4);
      material += sgn * VAL[t];
      if (t === K) {
        kingMg += sgn * PST[K][idx]; kingEg += sgn * KING_EG[idx];
        // pawn shield: pawns on the two files-ranks in front of a king that is still near home
        if (rr <= 1) {
          let s = 0;
          for (let df = -1; df <= 1; df++) {
            const ff = f + df;
            if (ff < 1 || ff > 8) continue;
            const dir = c ? -16 : 16, base = sq + df;
            if (base & 0x88) continue;
            const s1 = base + dir, s2 = base + 2 * dir;
            if (!(s1 & 0x88) && b[s1] === (P | (c << 3))) s += 12;
            else if (!(s2 & 0x88) && b[s2] === (P | (c << 3))) s += 6;
            else if (pawnCnt[c][ff] === 0) s -= 10;
          }
          kingSafety += sgn * s;
        }
        continue;
      }
      position += sgn * PST[t][idx];
      if (t === P) {
        const o = c ^ 1;
        if (pawnCnt[c][f] > 1 && pawnMax[c][f] === rr) pawns -= sgn * 10 * (pawnCnt[c][f] - 1);
        if (pawnCnt[c][f - 1] === 0 && pawnCnt[c][f + 1] === 0) pawns -= sgn * 12;
        // passed: no enemy pawn ahead on this or adjacent files
        let passed = true;
        for (let ff = f - 1; ff <= f + 1; ff++) {
          if (ff < 1 || ff > 8) continue;
          if (pawnMax[o][ff] >= 0 && (7 - pawnMax[o][ff]) > rr) { passed = false; break; }
        }
        if (passed) pawns += sgn * PASSED[rr];
      } else if (t === N) {
        npm += 1;
        let cnt = 0;
        for (let i = 0; i < 8; i++) { const s = sq + N_OFF[i]; if (!(s & 0x88) && (!b[s] || (b[s] >> 3) !== c)) cnt++; }
        mobility += sgn * (cnt - 4) * 4;
      } else if (t === B) {
        npm += 1; bishops[c]++;
        mobility += sgn * (slide(b, sq, B_OFF, c) - 6) * 3;
      } else if (t === R) {
        npm += 2;
        mobility += sgn * (slide(b, sq, R_OFF, c) - 7) * 2;
        if (pawnCnt[c][f] === 0) rooks += sgn * (pawnCnt[c ^ 1][f] === 0 ? 18 : 9);
      } else if (t === Q) {
        npm += 4;
        mobility += sgn * (slide(b, sq, K_OFF, c) - 10);
      }
    }
    if (bishops[0] >= 2) bishopPair += 30;
    if (bishops[1] >= 2) bishopPair -= 30;
    const phase = Math.min(24, npm) / 24;
    position += Math.round(kingMg * phase + kingEg * (1 - phase));
    kingSafety = Math.round(kingSafety * phase);
    const total = material + position + mobility + pawns + bishopPair + rooks + kingSafety;
    if (out) {
      out.material = material; out.position = position; out.mobility = mobility; out.pawns = pawns;
      out.bishopPair = bishopPair; out.rooks = rooks; out.kingSafety = kingSafety; out.total = total; out.phase = phase;
    }
    return total;
  }

  const FACTORS = [
    ['material', 'Material', 'Piece values: P100 N320 B330 R500 Q900'],
    ['position', 'Piece placement', 'Piece-square tables (centre control, advanced pawns, king safety by game phase)'],
    ['mobility', 'Mobility', 'How many squares knights, bishops, rooks and queens can reach'],
    ['pawns', 'Pawn structure', 'Passed pawns bonus, isolated pawn penalty'],
    ['bishopPair', 'Bishop pair', '+30 for owning both bishops'],
    ['rooks', 'Rook files', 'Rooks on open and half-open files'],
    ['kingSafety', 'King safety', 'Pawn shield in front of the king (middlegame only)']
  ];

  // Move-ordering helper: piece-square gain of a quiet move
  function pstDelta(piece, from, to) {
    const t = piece & 7, c = piece >> 3;
    return PST[t][IDX[c][to]] - PST[t][IDX[c][from]];
  }

  G.EV = { VAL, MATE, evaluate, FACTORS, pstDelta };
})(window);

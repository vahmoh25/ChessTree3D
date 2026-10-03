/* Procedural 3D chess piece models (lathe profiles + a few extras). */
(function (G) {
  'use strict';
  const T = G.THREE;

  const lathe = (pts, seg = 40) => new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg);
  const geoCache = {};

  const BASE = [[0, 0], [0.36, 0], [0.38, 0.03], [0.38, 0.07], [0.33, 0.11], [0.27, 0.13]];

  function merge(geos) {
    // tiny merge helper (non-indexed) so each piece type is a single mesh
    let pos = [], nor = [];
    for (const g0 of geos) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      pos.push(...g.attributes.position.array);
      nor.push(...g.attributes.normal.array);
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    return out;
  }
  const sphere = (r, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const g = new T.SphereGeometry(r, 24, 16);
    g.scale(sx, sy, sz); g.translate(x, y, z);
    return g;
  };
  const box = (w, h, d, x, y, z) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };

  function pawn() {
    const body = lathe([...BASE, [0.17, 0.2], [0.12, 0.34], [0.11, 0.46], [0.17, 0.5], [0.2, 0.53], [0.17, 0.56], [0.1, 0.58], [0, 0.58]]);
    return merge([body, sphere(0.17, 0, 0.7, 0)]);
  }
  function rook() {
    const body = lathe([...BASE, [0.22, 0.18], [0.19, 0.4], [0.19, 0.62], [0.27, 0.66], [0.28, 0.78], [0.22, 0.78], [0.22, 0.72], [0, 0.72]]);
    const parts = [body];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const g = new T.BoxGeometry(0.11, 0.12, 0.13);
      g.translate(0, 0, 0.245);
      g.rotateY(a); g.translate(0, 0.84, 0);
      parts.push(g);
    }
    return merge(parts);
  }
  function bishop() {
    const body = lathe([...BASE, [0.19, 0.2], [0.12, 0.4], [0.11, 0.55], [0.2, 0.6], [0.21, 0.66], [0.15, 0.7], [0, 0.7]]);
    return merge([body, sphere(0.18, 0, 0.87, 0, 1, 1.45, 1), sphere(0.055, 0, 1.14, 0)]);
  }
  function queen() {
    const body = lathe([...BASE, [0.2, 0.2], [0.14, 0.45], [0.12, 0.7], [0.24, 0.8], [0.27, 0.86], [0.22, 0.92], [0.12, 0.95], [0, 0.95]]);
    const parts = [body, sphere(0.075, 0, 1.08, 0)];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      parts.push(sphere(0.05, Math.sin(a) * 0.23, 0.98, Math.cos(a) * 0.23));
    }
    return merge(parts);
  }
  function king() {
    const body = lathe([...BASE, [0.21, 0.2], [0.15, 0.45], [0.13, 0.75], [0.25, 0.85], [0.26, 0.92], [0.2, 0.98], [0.1, 1.0], [0, 1.0]]);
    return merge([body, box(0.08, 0.32, 0.08, 0, 1.17, 0), box(0.24, 0.08, 0.08, 0, 1.19, 0)]);
  }
  function knight() {
    const base = lathe([...BASE, [0.26, 0.17], [0.27, 0.22], [0, 0.22]]);
    const s = new T.Shape();
    // head profile facing -x; units ~ board squares
    const pts = [[-0.26, 0.2], [-0.3, 0.45], [-0.24, 0.72], [-0.12, 0.9], [-0.04, 1.02], [0.0, 0.88], [0.1, 0.9],
      [0.32, 0.64], [0.38, 0.52], [0.34, 0.45], [0.2, 0.47], [0.05, 0.42], [0.2, 0.3], [0.26, 0.2]];
    s.moveTo(-pts[0][0], pts[0][1]);
    pts.forEach((p, i) => { if (i) s.lineTo(-p[0], p[1]); });
    s.closePath();
    const ex = new T.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, steps: 1 });
    ex.translate(0, 0, -0.15);
    ex.computeVertexNormals();
    return merge([base, ex]);
  }

  const BUILDERS = { 1: pawn, 2: knight, 3: bishop, 4: rook, 5: queen, 6: king };
  function geometry(type) {
    if (!geoCache[type]) {
      const g = BUILDERS[type]();
      g.computeBoundingSphere();
      geoCache[type] = g;
    }
    return geoCache[type];
  }

  const mats = {};
  function material(color) {
    if (!mats[color]) {
      mats[color] = color === 0
        ? new T.MeshPhysicalMaterial({ color: 0xf1e8d4, roughness: 0.32, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.25 })
        : new T.MeshPhysicalMaterial({ color: 0x23252d, roughness: 0.28, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    }
    return mats[color];
  }

  /** Create a mesh for a piece code (type | color<<3). */
  function makePiece(code) {
    const type = code & 7, color = code >> 3;
    const mesh = new T.Mesh(geometry(type), material(color));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const group = new T.Group();
    group.add(mesh);
    if (type === 2) mesh.rotation.y = color === 0 ? -Math.PI / 2 : Math.PI / 2;
    group.userData.code = code;
    return group;
  }

  G.Pieces = { makePiece, geometry, material };
})(window);

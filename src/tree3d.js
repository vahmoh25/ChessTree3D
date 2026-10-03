/* Interactive 3D visualisation of the minimax / alpha-beta search tree. */
(function (G) {
  'use strict';
  const T = G.THREE, SR = G.SR, ST = SR.ST, MATE = SR.MATE;
  const CAP = 6500, SEG = 8;
  const PLY_H = 10;
  const BASE_SIZE = [1.9, 1.05, 0.62, 0.4, 0.3, 0.26, 0.22];

  function fmtVal(v, plain) {
    if (v == null) return '–';
    if (v >= 1e8) return '+∞';
    if (v <= -1e8) return '−∞';
    if (Math.abs(v) >= MATE - 200) {
      const m = Math.ceil((MATE - Math.abs(v)) / 2);
      return (v > 0 ? '+' : '−') + 'M' + m;
    }
    const x = (v / 100).toFixed(2);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(+x).toFixed(2);
  }

  const C = {
    neutral: new T.Color(0xc9d1e0), white: new T.Color(0x35c8ff), black: new T.Color(0xb35cff),
    red: new T.Color(0xff3d55), amber: new T.Color(0xffb020), active: new T.Color(0xfff2a0), pv: new T.Color(0x3dff94),
    mate: new T.Color(0xffffff)
  };
  function valueColor(v, out) {
    let t = Math.tanh(v / 350);
    if (Math.abs(v) >= MATE - 200) t = Math.sign(v);
    out.copy(C.neutral);
    out.lerp(t >= 0 ? C.white : C.black, Math.min(1, Math.abs(t) * 1.15));
    return out;
  }

  function glowTexture(ring) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    if (ring) {
      x.strokeStyle = '#fff'; x.lineWidth = 7; x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.stroke();
    } else {
      const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
    return new T.CanvasTexture(c);
  }

  function textSprite(text, color) {
    const c = document.createElement('canvas'); c.width = 768; c.height = 96;
    const x = c.getContext('2d');
    x.font = '600 44px system-ui, sans-serif'; x.fillStyle = color; x.textBaseline = 'middle';
    x.fillText(text, 8, 48);
    const tex = new T.CanvasTexture(c);
    const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }));
    s.scale.set(24, 3, 1); s.center.set(0, 0.5);
    return s;
  }

  class TreeView {
    constructor(container, opts = {}) {
      this.container = container;
      this.onSelect = opts.onSelect || (() => {});
      this.onHover = opts.onHover || (() => {});
      const r = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.toneMapping = T.ACESFilmicToneMapping;
      container.appendChild(r.domElement);
      r.domElement.className = 'gl';
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(45, 1, 0.2, 2500);
      this.ctl = new G.Orbit(this.camera, r.domElement, { target: new T.Vector3(0, 10, 0), radius: 55, theta: 0.7, phi: 1.1, minR: 3, maxR: 900 });
      this.autoFit = true;
      this.ctl.onUser = () => { this.autoFit = false; if (this.onAutoFitChange) this.onAutoFitChange(false); };
      this.labelMode = 1; this.showAB = true; this.showRings = true;
      this.search = null; this.seen = 0; this.evIdx = 0;
      this.time = 0; this.lastLayout = 0; this.layoutDirty = false;
      this.selected = null; this.hovered = null; this.mouse = null;
      this.prevPath = [];
      this.R = [0]; this.cutNodes = [];
      this.tmp = new T.Color(); this.m4 = new T.Matrix4();

      this._build();
      this._bind();
      new ResizeObserver(() => this.resize()).observe(container);
      this.resize();
    }

    _build() {
      const s = this.scene;
      s.add(new T.HemisphereLight(0xcfe0ff, 0x1b1f33, 1.1));
      const d = new T.DirectionalLight(0xffffff, 2.0); d.position.set(30, 60, 40); s.add(d);
      const mkInst = (geo) => {
        const mat = new T.MeshStandardMaterial({ roughness: 0.38, metalness: 0.15 });
        const im = new T.InstancedMesh(geo, mat, CAP);
        im.instanceMatrix.setUsage(T.DynamicDrawUsage);
        im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
        im.instanceColor.setUsage(T.DynamicDrawUsage);
        im.count = 0; im.frustumCulled = false;
        s.add(im);
        return im;
      };
      this.maxMesh = mkInst(new T.IcosahedronGeometry(1, 2));
      this.minMesh = mkInst(new T.OctahedronGeometry(1.3, 0));
      this.maxCount = 0; this.minCount = 0;
      const torus = new T.TorusGeometry(1, 0.1, 8, 28); torus.rotateX(Math.PI / 2);
      this.cutMesh = new T.InstancedMesh(torus, new T.MeshBasicMaterial({ color: 0xff8a2b }), 1500);
      this.cutMesh.count = 0; this.cutMesh.frustumCulled = false; s.add(this.cutMesh);

      // edges
      const eg = this.edgeGeo = new T.BufferGeometry();
      this.ePos = new Float32Array(CAP * SEG * 6); this.eCol = new Float32Array(CAP * SEG * 6);
      eg.setAttribute('position', new T.BufferAttribute(this.ePos, 3).setUsage(T.DynamicDrawUsage));
      eg.setAttribute('color', new T.BufferAttribute(this.eCol, 3).setUsage(T.DynamicDrawUsage));
      eg.setDrawRange(0, 0);
      this.edges = new T.LineSegments(eg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
      this.edges.frustumCulled = false; s.add(this.edges);

      // sprites
      const glowT = glowTexture(false), ringT = glowTexture(true);
      const spr = (tex, color, blend) => {
        const m = new T.Sprite(new T.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, depthTest: false, blending: blend ? T.AdditiveBlending : T.NormalBlending }));
        m.visible = false; m.renderOrder = 20; s.add(m); return m;
      };
      this.glow = spr(glowT, 0xffe27a, true);
      this.selRing = spr(ringT, 0xffffff, false);
      this.hovRing = spr(ringT, 0x4cc9f0, false);
      this.shocks = [];
      for (let i = 0; i < 12; i++) { const sh = spr(ringT, 0xff8a2b, true); sh.userData.t = 9; this.shocks.push(sh); }

      // path / best-line tubes
      this.bestTube = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x3dff94, transparent: true, opacity: 0.85 }));
      this.bestTube.frustumCulled = false; s.add(this.bestTube);
      this.pvGlow = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x3dff94, transparent: true, opacity: 0.22, depthWrite: false }));
      this.pvGlow.frustumCulled = false; s.add(this.pvGlow);
      this.selLine = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
      this.selLine.frustumCulled = false; this.selLine.visible = false; s.add(this.selLine);

      // ply guide rings + labels
      this.ringGroup = new T.Group(); s.add(this.ringGroup);
      this.ringMeshes = [];
      this.labelDiv = document.createElement('div'); this.labelDiv.className = 'labels';
      this.container.appendChild(this.labelDiv);
      this.labelPool = [];
    }

    _bind() {
      const dom = this.renderer.domElement;
      dom.addEventListener('pointermove', e => {
        const r = dom.getBoundingClientRect();
        this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
      });
      dom.addEventListener('pointerleave', () => { this.mouse = null; this.setHover(null); });
      let down = null;
      dom.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
      dom.addEventListener('pointerup', e => {
        if (!down || down.b !== 0) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && this.ctl.travel < 8) {
          const r = dom.getBoundingClientRect();
          const n = this.pickAt(e.clientX - r.left, e.clientY - r.top);
          this.setSelected(n, true);
        }
        down = null;
      });
      dom.addEventListener('dblclick', e => {
        const r = dom.getBoundingClientRect();
        const n = this.pickAt(e.clientX - r.left, e.clientY - r.top);
        if (n) this.focusNode(n);
      });
    }

    resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }

    /** Start visualising a new search. */
    setSearch(search) {
      this.search = search;
      this.seen = 0; this.evIdx = 0;
      this.maxCount = 0; this.minCount = 0; this.maxMesh.count = 0; this.minMesh.count = 0; this.cutMesh.count = 0;
      this.cutNodes = [];
      this.edgeGeo.setDrawRange(0, 0);
      this.selected = null; this.hovered = null;
      this.selRing.visible = false; this.hovRing.visible = false; this.glow.visible = false; this.selLine.visible = false;
      this.bestTube.geometry.dispose(); this.bestTube.geometry = new T.BufferGeometry();
      this.pvGlow.geometry.dispose(); this.pvGlow.geometry = new T.BufferGeometry();
      this.prevPath = []; this.bestLine = [];
      this.R = [0];
      this.layoutDirty = true; this.lastLayout = 0;
      this.autoFit = true;
      this.ctl.target.set(0, 8, 0);
      if (this.onAutoFitChange) this.onAutoFitChange(true);
      // guide rings
      this.ringMeshes.forEach(m => { this.ringGroup.remove(m.line); this.scene.remove(m.label); });
      this.ringMeshes = [];
      if (search) {
        const pts = [];
        for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new T.Vector3(Math.cos(a), 0, Math.sin(a))); }
        const rootMax = search.rootPos.turn === 0;
        for (let p = 0; p <= search.recDepth; p++) {
          const line = new T.LineLoop(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x3a4768, transparent: true, opacity: 0.55 }));
          line.visible = p > 0; this.ringGroup.add(line);
          const max = (p % 2 === 0) === rootMax;
          const side = max ? 'White' : 'Black';
          const label = textSprite(`PLY ${p} · ${side} to move · ${max ? 'MAX' : 'MIN'}`, max ? '#7fd8ff' : '#d3a4ff');
          this.scene.add(label);
          this.ringMeshes.push({ line, label });
        }
      }
      this.updateRingTransforms();
    }

    updateRingTransforms() {
      this.ringMeshes.forEach((m, p) => {
        const r = this.R[p] || 0;
        m.line.scale.set(Math.max(r, 0.01), 1, Math.max(r, 0.01));
        m.line.position.y = p * PLY_H;
        m.line.visible = this.showRings && p > 0;
        m.label.position.set(p === 0 ? 3 : r + 3, p * PLY_H, 0);
        m.label.visible = this.showRings;
      });
    }

    _initNode(n) {
      n.appear = 0;
      const p = n.parent;
      if (p) { n.x = p.x; n.y = p.y; n.z = p.z; n.tx = p.tx; n.ty = p.ty; n.tz = p.tz; }
      if (n.maximizing) { n.inst = this.maxCount++; n.kind = 0; } else { n.inst = this.minCount++; n.kind = 1; }
      this.maxMesh.count = this.maxCount; this.minMesh.count = this.minCount;
      this.edgeGeo.setDrawRange(0, (n.id + 1) * SEG * 2);
    }

    layout() {
      const L = this.search.list, n = L.length;
      if (!n) return;
      for (let i = 0; i < n; i++) L[i].w = 0;
      const counts = [];
      for (let i = n - 1; i >= 0; i--) {
        const node = L[i];
        if (node.children.length === 0) node.w = node.state === ST.PRUNED ? 0.12 : 1;
        else if (node.state === ST.ACTIVE) node.w += Math.max(0, node.nMoves - node.children.length) * 0.3;
        if (node.parent) node.parent.w += node.w;
        counts[node.ply] = (counts[node.ply] || 0) + (node.state === ST.PRUNED ? 0.2 : 1);
      }
      const R = [0];
      for (let p = 1; p < counts.length; p++) {
        const spacing = p <= 2 ? 1.6 : 0.7;
        R[p] = Math.max(R[p - 1] + 14, counts[p] * spacing / (Math.PI * 2));
      }
      this.R = R;
      L[0].a0 = 0; L[0].a1 = Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const node = L[i];
        const span = node.a1 - node.a0, tot = node.w || 1;
        let cur = node.a0;
        for (const c of node.children) { c.a0 = cur; cur += span * c.w / tot; c.a1 = cur; }
        const ang = (node.a0 + node.a1) / 2, r = R[node.ply] || 0;
        node.tx = Math.cos(ang) * r; node.tz = Math.sin(ang) * r; node.ty = node.ply * PLY_H;
      }
      this.updateRingTransforms();
      this.boundsDirty = true;
    }

    sizeOf(n) {
      const base = BASE_SIZE[Math.min(n.ply, BASE_SIZE.length - 1)];
      if (n.state === ST.PRUNED) return base * 0.55;
      const sub = n.state === ST.DONE ? n.subtree : this.search.nodes - n.nodes0;
      const f = Math.min(2.3, 0.78 + 0.13 * Math.log2(1 + Math.max(0, sub)));
      return base * f;
    }

    colorOf(n, out) {
      if (n.state === ST.PRUNED) return out.copy(C.red).multiplyScalar(0.8);
      if (n.state === ST.ACTIVE) {
        if (n === this.search.current) { const k = 0.5 + 0.5 * Math.sin(this.time * 9); return out.copy(C.active).lerp(C.amber, k * 0.4); }
        return out.copy(C.amber);
      }
      if (n.pv && this.search.done) return out.copy(C.pv);
      return valueColor(n.value == null ? 0 : n.value, out);
    }

    edgeColor(n, o) {
      if (n.state === ST.PRUNED) { o[0] = 0.75; o[1] = 0.16; o[2] = 0.24; return; }
      if (this.selSet && this.selSet.has(n)) { o[0] = 1; o[1] = 1; o[2] = 1; return; }
      if (n.pv && this.search.done) { o[0] = 0.24; o[1] = 1; o[2] = 0.58; return; }
      if (n.state === ST.ACTIVE) { o[0] = 1; o[1] = 0.72; o[2] = 0.1; return; }
      if (n.parent && n.parent.bestChild === n) { o[0] = 0.2; o[1] = 0.85; o[2] = 0.75; return; }
      o[0] = 0.26; o[1] = 0.32; o[2] = 0.5;
    }

    writeEdge(n) {
      const p = n.parent;
      if (!p) return;
      const base = n.id * SEG * 6, P = this.ePos, Cc = this.eCol;
      const ax = p.x, ay = p.y, az = p.z, bx = n.x, by = n.y, bz = n.z;
      const col = this._ec || (this._ec = [0, 0, 0]);
      this.edgeColor(n, col);
      const pruned = n.state === ST.PRUNED;
      for (let k = 0; k < SEG; k++) {
        const o = base + k * 6;
        let t0 = 0, t1 = 0;
        if (pruned) { if (k < 4) { t0 = k * 0.25 + 0.05; t1 = t0 + 0.13; } }
        else if (k === 0) { t0 = 0; t1 = 1; }
        P[o] = ax + (bx - ax) * t0; P[o + 1] = ay + (by - ay) * t0; P[o + 2] = az + (bz - az) * t0;
        P[o + 3] = ax + (bx - ax) * t1; P[o + 4] = ay + (by - ay) * t1; P[o + 5] = az + (bz - az) * t1;
        for (let j = 0; j < 2; j++) { Cc[o + j * 3] = col[0]; Cc[o + j * 3 + 1] = col[1]; Cc[o + j * 3 + 2] = col[2]; }
      }
    }

    setSelected(n, fromUser) {
      this.selected = n || null;
      this.selSet = new Set();
      for (let x = n; x; x = x.parent) this.selSet.add(x);
      if (this.search) this.search.list.forEach(x => { if (x.state !== ST.PENDING) {} });
      this.selDirty = true;
      this.onSelect(this.selected, fromUser);
    }

    setHover(n) {
      if (n === this.hovered) { if (n) this.onHover(n, this.mouse); return; }
      this.hovered = n;
      this.onHover(n, this.mouse);
    }

    focusNode(n) {
      this.autoFit = false;
      if (this.onAutoFitChange) this.onAutoFitChange(false);
      this.ctl.flyTo(new T.Vector3(n.tx, n.ty, n.tz), Math.max(8, this.sizeOf(n) * 14), null, null, 0.8);
    }

    pickAt(mx, my) {
      if (!this.search) return null;
      const L = this.search.list, cam = this.camera, w = this.container.clientWidth, h = this.container.clientHeight;
      const v = new T.Vector3();
      let best = null, bestScore = 1e9;
      const k = (h / 2) / Math.tan(cam.fov * Math.PI / 360);
      for (let i = 0; i < L.length; i++) {
        const n = L[i];
        if (n.appear < 0.3) continue;
        v.set(n.x, n.y, n.z).applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -0.1) continue;
        const dist = -v.z;
        const px = (v.x / dist) * k + w / 2, py = h / 2 - (v.y / dist) * k;
        const rpx = this.sizeOf(n) * k / dist;
        const d = Math.hypot(px - mx, py - my);
        const lim = Math.max(7, rpx + 3);
        if (d > lim) continue;
        const score = d / lim + dist * 0.0005;
        if (score < bestScore) { bestScore = score; best = n; }
      }
      return best;
    }

    spawnShock(n) {
      const sh = this.shocks.find(s => s.userData.t >= 1);
      if (!sh) return;
      sh.userData.t = 0; sh.userData.n = n; sh.visible = true;
    }

    update(dt) {
      this.time += dt;
      const S = this.search;
      if (S) this._sync(dt);
      this.ctl.update(dt);
      this.camera.updateMatrixWorld();
      this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
      if (S && this.mouse && !this.ctl.dragging) this.setHover(this.pickAt(this.mouse.x, this.mouse.y));
      this.renderer.render(this.scene, this.camera);
      this._labels();
    }

    _sync(dt) {
      const S = this.search, L = S.list;
      let structural = false;
      while (this.seen < L.length) { this._initNode(L[this.seen]); this.seen++; structural = true; }
      if (structural) this.layoutDirty = true;
      const now = this.time;
      if (this.layoutDirty && now - this.lastLayout > 0.1) { this.layout(); this.layoutDirty = false; this.lastLayout = now; }

      // events
      for (; this.evIdx < S.events.length; this.evIdx++) {
        const e = S.events[this.evIdx];
        if (e.type === 'cut' && e.node && e.remaining > 0 && this.cutMesh.count < 1500) {
          this.cutNodes.push(e.node); this.cutMesh.count = this.cutNodes.length;
          this.spawnShock(e.node);
        }
      }

      // current path highlighting
      const path = [];
      for (let n = S.current; n; n = n.parent) path.push(n);
      const dirty = S.dirty;
      if (path.length !== this.prevPath.length || path.some((n, i) => n !== this.prevPath[i])) {
        this.prevPath.forEach(n => dirty.add(n)); path.forEach(n => dirty.add(n));
        this.prevPath = path;
      }
      // best line (follows bestChild from the root)
      const bl = [];
      for (let n = S.root; n; n = n.bestChild) bl.push(n);
      if (bl.length !== this.bestLine.length || bl.some((n, i) => n !== this.bestLine[i])) { this.bestLine = bl; this.tubeDirty = true; }
      if (this.selDirty) { this.search.list.forEach(n => dirty.add(n)); this.selDirty = false; }

      // per-node update
      const k = Math.min(1, dt * 5.5);
      const hot = new Set(path);
      const moved = this._moved && this._moved.length >= L.length ? this._moved : (this._moved = new Uint8Array(CAP));
      moved.fill(0, 0, L.length);
      const m4 = this.m4, el = m4.elements, col = this.tmp;
      let anyMoved = false, edgeChanged = false, matChanged = false, colChanged = false;
      const mm = this.maxMesh, nm = this.minMesh;
      for (let i = 0; i < L.length; i++) {
        const n = L[i];
        let mv = false;
        const dx = n.tx - n.x, dy = n.ty - n.y, dz = n.tz - n.z;
        if (dx * dx + dy * dy + dz * dz > 1e-5) { n.x += dx * k; n.y += dy * k; n.z += dz * k; mv = true; }
        let ap = false;
        if (n.appear < 1) { n.appear = Math.min(1, n.appear + dt / 0.45); ap = true; }
        const isDirty = dirty.has(n), isHot = hot.has(n);
        if (mv || ap || isDirty || isHot) {
          const e = n.appear, back = 1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2);
          const s = this.sizeOf(n) * Math.max(0.001, back);
          el[0] = s; el[5] = s; el[10] = s; el[15] = 1; el[12] = n.x; el[13] = n.y; el[14] = n.z;
          el[1] = el[2] = el[3] = el[4] = el[6] = el[7] = el[8] = el[9] = el[11] = 0;
          const mesh = n.kind === 0 ? mm : nm;
          mesh.setMatrixAt(n.inst, m4); matChanged = true;
          if (isDirty || (isHot && n === S.current) || ap) {
            this.colorOf(n, col);
            mesh.setColorAt(n.inst, col); colChanged = true;
          }
        }
        if (mv) { moved[i] = 1; anyMoved = true; }
      }
      for (let i = 0; i < L.length; i++) {
        const n = L[i];
        if (!n.parent) continue;
        if (moved[i] || moved[n.parent.id] || dirty.has(n) || n.appear < 1) { this.writeEdge(n); edgeChanged = true; }
      }
      dirty.clear();
      if (matChanged) { mm.instanceMatrix.needsUpdate = true; nm.instanceMatrix.needsUpdate = true; }
      if (colChanged) { if (mm.instanceColor) mm.instanceColor.needsUpdate = true; if (nm.instanceColor) nm.instanceColor.needsUpdate = true; }
      if (edgeChanged) { this.edgeGeo.attributes.position.needsUpdate = true; this.edgeGeo.attributes.color.needsUpdate = true; }

      // cutoff rings
      if (this.cutNodes.length) {
        for (let i = 0; i < this.cutNodes.length; i++) {
          const n = this.cutNodes[i], s = this.sizeOf(n) * 1.9;
          el[0] = s; el[5] = s; el[10] = s; el[15] = 1; el[12] = n.x; el[13] = n.y; el[14] = n.z;
          el[1] = el[2] = el[3] = el[4] = el[6] = el[7] = el[8] = el[9] = el[11] = 0;
          this.cutMesh.setMatrixAt(i, m4);
        }
        this.cutMesh.instanceMatrix.needsUpdate = true;
      }

      // sprites
      const cur = S.current;
      if (cur && !S.done) {
        this.glow.visible = true; this.glow.position.set(cur.x, cur.y, cur.z);
        const gs = this.sizeOf(cur) * (5 + Math.sin(this.time * 8) * 0.8); this.glow.scale.set(gs, gs, 1);
      } else this.glow.visible = false;
      const placeRing = (spr, n, mul) => {
        if (!n) { spr.visible = false; return; }
        spr.visible = true; spr.position.set(n.x, n.y, n.z);
        const sc = this.sizeOf(n) * mul; spr.scale.set(sc, sc, 1);
      };
      placeRing(this.selRing, this.selected, 3.2 + Math.sin(this.time * 4) * 0.2);
      placeRing(this.hovRing, this.hovered && this.hovered !== this.selected ? this.hovered : null, 3.0);
      for (const sh of this.shocks) {
        if (sh.userData.t >= 1) { sh.visible = false; continue; }
        sh.userData.t = Math.min(1, sh.userData.t + dt / 1.0);
        const t = sh.userData.t, n = sh.userData.n;
        sh.position.set(n.x, n.y, n.z);
        const sc = this.sizeOf(n) * (2.5 + t * 13); sh.scale.set(sc, sc, 1);
        sh.material.opacity = (1 - t) * 0.9;
      }

      // selected path line
      if (this.selected) {
        const pts = [];
        for (let n = this.selected; n; n = n.parent) pts.push(n.x, n.y, n.z);
        this.selLine.geometry.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
        this.selLine.visible = true;
      } else this.selLine.visible = false;

      // tubes: live best line and final principal variation
      if ((this.tubeDirty || anyMoved) && now - (this._tubeT || 0) > 0.05) {
        this._tubeT = now; this.tubeDirty = false;
        const line = this.bestLine.filter(n => n.state !== ST.PENDING);
        this._tube(this.bestTube, line, S.done ? 0.34 : 0.16);
        this._tube(this.pvGlow, S.done ? line : [], 0.9);
      }
      this.bestTube.material.color.set(S.done ? 0x3dff94 : 0x7dffc2);

      // auto fit camera to the growing tree
      if (this.autoFit && this.boundsDirty && now - (this._fitT || 0) > 0.8) {
        this._fitT = now; this.boundsDirty = false;
        this.fit(1.1);
      }
    }

    _tube(mesh, nodes, radius) {
      mesh.geometry.dispose();
      if (nodes.length < 2) { mesh.visible = false; mesh.geometry = new T.BufferGeometry(); return; }
      const pts = nodes.map(n => new T.Vector3(n.x, n.y, n.z));
      const curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
      mesh.geometry = new T.TubeGeometry(curve, nodes.length * 10, radius, 8, false);
      mesh.visible = true;
    }

    /** Frame the whole tree. */
    fit(duration) {
      const S = this.search;
      if (!S || !S.list.length) return;
      let maxR = 8, maxY = 0;
      for (const n of S.list) { maxR = Math.max(maxR, Math.hypot(n.tx, n.tz)); maxY = Math.max(maxY, n.ty); }
      const center = new T.Vector3(0, maxY / 2, 0);
      const rad = Math.hypot(maxR, maxY / 2 + 4) * 1.05;
      const fovV = this.camera.fov * Math.PI / 180, fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
      const dist = rad / Math.sin(Math.min(fovV, fovH) / 2);
      this.ctl.flyTo(center, Math.min(this.ctl.maxR, Math.max(25, dist * 1.0)), null, null, duration == null ? 0.8 : duration);
    }

    _labels() {
      const S = this.search;
      const pool = this.labelPool, show = [];
      if (S && this.labelMode > 0) {
        const L = S.list;
        for (const n of L) {
          if (n.appear < 0.5) continue;
          if (n.ply === 0) continue;
          if (n.ply === 1 && n.state !== ST.PRUNED) show.push(n);
          else if (this.labelMode > 1 && n.ply === 2 && n.state === ST.DONE && show.length < 70) show.push(n);
          else if (n.pv && S.done) show.push(n);
        }
        if (S.current && S.current.ply > 0 && !show.includes(S.current)) show.push(S.current);
        if (this.hovered && !show.includes(this.hovered)) show.push(this.hovered);
        if (this.selected && this.selected.ply > 0 && !show.includes(this.selected)) show.push(this.selected);
      }
      const w = this.container.clientWidth, h = this.container.clientHeight, v = new T.Vector3();
      let used = 0;
      const placed = [];
      // highest priority first: hovered / selected / current, then the rest
      show.sort((a, b) => ((b === this.hovered) * 4 + (b === this.selected) * 3 + (b === S.current) * 2 + (b.pv ? 1 : 0)) - ((a === this.hovered) * 4 + (a === this.selected) * 3 + (a === S.current) * 2 + (a.pv ? 1 : 0)));
      for (const n of show) {
        if (used >= 90) break;
        v.set(n.x, n.y, n.z).project(this.camera);
        if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
        const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
        const isHot = n === this.hovered || n === this.selected || n === S.current;
        if (!isHot && placed.some(p => Math.abs(p[0] - sx) < 62 && Math.abs(p[1] - sy) < 30)) continue;
        placed.push([sx, sy]);
        let el = pool[used];
        if (!el) { el = document.createElement('div'); el.className = 'nlabel'; this.labelDiv.appendChild(el); pool[used] = el; }
        const hot = n === this.hovered || n === this.selected || n === S.current;
        let html = `<b>${S.sanOf(n)}</b> <span class="v">${n.bound || ''}${n.value == null ? '' : fmtVal(n.value)}</span>`;
        if (this.showAB && (n.ply === 1 || hot) && n.state !== ST.PRUNED) html += `<i>α ${fmtVal(n.state === ST.DONE ? n.alphaIn : n.alpha)} β ${fmtVal(n.state === ST.DONE ? n.betaIn : n.beta)}</i>`;
        if (el._h !== html) { el.innerHTML = html; el._h = html; }
        const cls = 'nlabel' + (hot ? ' hot' : '') + (n.pv && S.done ? ' pv' : '');
        if (el.className !== cls) el.className = cls;
        el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -140%)`;
        el.style.display = 'block';
        used++;
      }
      for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
    }
  }

  G.TreeView = TreeView;
  G.fmtVal = fmtVal;
  G.valueColor = valueColor;
})(window);

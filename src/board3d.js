/* The interactive 3D chessboard. */
(function (G) {
  'use strict';
  const T = G.THREE, CH = G.CH;
  const sqX = sq => (sq & 7) - 3.5;
  const sqZ = sq => 3.5 - (sq >> 4);
  const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

  function labelTexture(text) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#e9d9b8'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 32, 34);
    const t = new T.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function makeEnvironment(renderer) {
    const s = new T.Scene();
    const grad = document.createElement('canvas');
    grad.width = 4; grad.height = 256;
    const g = grad.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, '#5b6a8c'); lg.addColorStop(0.5, '#2a3148'); lg.addColorStop(1, '#14161f');
    g.fillStyle = lg; g.fillRect(0, 0, 4, 256);
    const sky = new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.MeshBasicMaterial({ map: new T.CanvasTexture(grad), side: T.BackSide }));
    s.add(sky);
    const panel = (w, h, x, y, z, col, i) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(i), side: T.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
    };
    panel(30, 14, 0, 30, 10, 0xffffff, 4); panel(10, 22, -35, 12, 0, 0xcfe0ff, 2.2);
    panel(10, 22, 35, 12, 8, 0xffe6c4, 2.6); panel(24, 8, 0, 8, -35, 0xffffff, 1.6);
    const pm = new T.PMREMGenerator(renderer);
    const rt = pm.fromScene(s, 0.04);
    pm.dispose();
    return rt.texture;
  }

  class BoardView {
    constructor(container, opts = {}) {
      this.container = container;
      this.onClick = opts.onClick || (() => {});
      const r = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      container.appendChild(r.domElement);
      r.domElement.className = 'gl';
      this.scene = new T.Scene();
      this.scene.environment = makeEnvironment(r);
      this.camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
      this.ctl = new G.Orbit(this.camera, r.domElement, { radius: 13, theta: 0, phi: 0.92, minR: 6, maxR: 26, maxPhi: 1.5, minPhi: 0.15 });
      this.pieces = new Map();
      this.tweens = [];
      this.last = null; this.selected = -1; this.check = -1; this.hover = -1;
      this.time = 0;
      this.ctl.onUser = () => { this.userMoved = true; };
      this._buildLights(); this._buildBoard(); this._buildOverlays();
      this._bindInput();
      new ResizeObserver(() => this.resize()).observe(container);
      this.resize();
    }

    _buildLights() {
      const s = this.scene;
      s.add(new T.HemisphereLight(0xb8c8ff, 0x20140c, 0.45));
      const key = new T.DirectionalLight(0xfff1dd, 2.2);
      key.position.set(6, 12, 7);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const sc = key.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 40;
      key.shadow.bias = -0.0004; key.shadow.radius = 4;
      s.add(key);
      const rim = new T.DirectionalLight(0x7fa6ff, 0.8); rim.position.set(-8, 6, -6); s.add(rim);
    }

    _buildBoard() {
      const g = this.boardGroup = new T.Group();
      this.scene.add(g);
      const light = new T.MeshPhysicalMaterial({ color: 0xe6d3ad, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const dark = new T.MeshPhysicalMaterial({ color: 0x7b5237, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      this.squares = [];
      const geo = new T.BoxGeometry(1, 0.2, 1);
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f;
        const m = new T.Mesh(geo, (r + f) % 2 === 0 ? dark : light);
        m.position.set(sqX(sq), -0.1, sqZ(sq));
        m.receiveShadow = true;
        m.userData.sq = sq;
        g.add(m); this.squares.push(m);
      }
      const wood = new T.MeshPhysicalMaterial({ color: 0x2c1d14, roughness: 0.5, clearcoat: 0.4 });
      const slab = new T.Mesh(new T.BoxGeometry(9.6, 0.5, 9.6), wood);
      slab.position.y = -0.35; slab.receiveShadow = true; slab.castShadow = true; g.add(slab);
      const mkBar = (w, d, x, z) => {
        const m = new T.Mesh(new T.BoxGeometry(w, 0.22, d), wood);
        m.position.set(x, -0.02, z); m.receiveShadow = true; m.castShadow = true; g.add(m);
      };
      mkBar(9.6, 0.6, 0, 4.5); mkBar(9.6, 0.6, 0, -4.5); mkBar(0.6, 8.4, 4.5, 0); mkBar(0.6, 8.4, -4.5, 0);
      for (let i = 0; i < 8; i++) {
        const f = new T.Mesh(new T.PlaneGeometry(0.4, 0.4), new T.MeshBasicMaterial({ map: labelTexture('abcdefgh'[i]), transparent: true }));
        f.rotation.x = -Math.PI / 2; f.position.set(i - 3.5, 0.095, 4.5); g.add(f);
        const f2 = f.clone(); f2.position.z = -4.5; g.add(f2);
        const r = new T.Mesh(new T.PlaneGeometry(0.4, 0.4), new T.MeshBasicMaterial({ map: labelTexture(String(i + 1)), transparent: true }));
        r.rotation.x = -Math.PI / 2; r.position.set(-4.5, 0.095, 3.5 - i); g.add(r);
        const r2 = r.clone(); r2.position.x = 4.5; g.add(r2);
      }
      const shadowFloor = new T.Mesh(new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: 0.35 }));
      shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.position.y = -0.62; shadowFloor.receiveShadow = true;
      this.scene.add(shadowFloor);
      const glow = new T.Mesh(new T.CircleGeometry(9, 64), new T.MeshBasicMaterial({ color: 0x1b2a4a, transparent: true, opacity: 0.55 }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = -0.63; this.scene.add(glow);
    }

    _buildOverlays() {
      const plane = new T.PlaneGeometry(1, 1);
      const mk = (color, op) => new T.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false });
      const flat = (mat, y) => { const m = new T.Mesh(plane, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.visible = false; m.renderOrder = 2; this.scene.add(m); return m; };
      this.hlLast = [flat(mk(0x4cc9f0, 0.35), 0.012), flat(mk(0x4cc9f0, 0.35), 0.012)];
      this.hlSel = flat(mk(0xffd60a, 0.55), 0.014);
      this.hlCheck = flat(mk(0xff2d3d, 0.7), 0.016);
      this.hlHover = flat(mk(0xffffff, 0.18), 0.013);
      this.dots = []; this.rings = [];
      const dotG = new T.CircleGeometry(0.17, 24), ringG = new T.RingGeometry(0.36, 0.46, 32);
      for (let i = 0; i < 40; i++) {
        const d = new T.Mesh(dotG, mk(0x2ee6a6, 0.75)); d.rotation.x = -Math.PI / 2; d.position.y = 0.02; d.visible = false; d.renderOrder = 3; this.scene.add(d); this.dots.push(d);
        const r = new T.Mesh(ringG, mk(0xff5a6e, 0.85)); r.rotation.x = -Math.PI / 2; r.position.y = 0.02; r.visible = false; r.renderOrder = 3; this.scene.add(r); this.rings.push(r);
      }
      // arrows (examined moves)
      this.arrows = [];
      for (let i = 0; i < 8; i++) {
        const grp = new T.Group();
        const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
        const shaft = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 1, 12), mat);
        shaft.rotation.z = Math.PI / 2; // along +x
        const head = new T.Mesh(new T.ConeGeometry(0.2, 0.4, 16), mat);
        head.rotation.z = -Math.PI / 2;
        grp.add(shaft, head);
        grp.visible = false; grp.renderOrder = 10;
        shaft.renderOrder = head.renderOrder = 10;
        grp.userData = { shaft, head, mat };
        this.scene.add(grp); this.arrows.push(grp);
      }
    }

    _placeFlat(mesh, sq) { mesh.position.x = sqX(sq); mesh.position.z = sqZ(sq); mesh.visible = true; }

    _bindInput() {
      const dom = this.renderer.domElement;
      this.ray = new T.Raycaster(); this.mouse = new T.Vector2();
      let down = null;
      dom.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
      dom.addEventListener('pointerup', e => {
        if (!down || down.b !== 0) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && this.ctl.travel < 8) {
          const sq = this.pick(e);
          if (sq >= 0) this.onClick(sq);
        }
        down = null;
      });
      dom.addEventListener('pointermove', e => {
        if (this.ctl.dragging) { this.setHover(-1); return; }
        this.setHover(this.pick(e));
      });
      dom.addEventListener('pointerleave', () => this.setHover(-1));
    }

    pick(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.ray.setFromCamera(this.mouse, this.camera);
      const objs = [...this.squares];
      this.pieces.forEach(p => objs.push(p));
      const hits = this.ray.intersectObjects(objs, true);
      for (const h of hits) {
        let o = h.object;
        while (o && o.userData.sq === undefined) o = o.parent;
        if (o) return o.userData.sq;
      }
      return -1;
    }

    setHover(sq) {
      if (sq === this.hover) return;
      this.hover = sq;
      if (sq >= 0) this._placeFlat(this.hlHover, sq); else this.hlHover.visible = false;
      this.renderer.domElement.style.cursor = sq >= 0 && this.interactive && this.interactive(sq) ? 'pointer' : '';
    }

    resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (!this.userMoved) this.ctl.radius = this.fitRadius();
    }

    fitRadius() { return Math.min(26, 13 * Math.max(1, 1.05 / this.camera.aspect)); }

    /** Rebuild all pieces from a position (no animation). */
    setPosition(pos) {
      this.tweens.length = 0;
      this.scene.children.filter(o => o.userData && o.userData.code !== undefined).forEach(o => this.scene.remove(o));
      this.pieces.clear();
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = pos.board[sq];
        if (p) this._addPiece(p, sq);
      }
    }

    _addPiece(code, sq) {
      const g = G.Pieces.makePiece(code);
      g.position.set(sqX(sq), 0, sqZ(sq));
      g.userData.sq = sq;
      this.scene.add(g);
      this.pieces.set(sq, g);
      return g;
    }

    get busy() { return this.tweens.length > 0; }

    tween(dur, fn, done) { this.tweens.push({ t: 0, dur, fn, done }); }

    /** Animate a (legal) move on the board. `fast` skips the animation. */
    playMove(m, fast) {
      const from = CH.mFrom(m), to = CH.mTo(m), fl = CH.mFlags(m), promo = CH.mPromo(m);
      const mover = this.pieces.get(from);
      if (!mover) return;
      this.pieces.delete(from);
      const color = mover.userData.code >> 3;
      let captured = this.pieces.get(to);
      if (fl & CH.F_EP) {
        const cs = to + (color ? 16 : -16);
        captured = this.pieces.get(cs); this.pieces.delete(cs);
      } else if (captured) this.pieces.delete(to);
      let rook = null, rFrom = 0, rTo = 0;
      if (fl & CH.F_CASTLE) {
        if (to > from) { rFrom = to + 1; rTo = from + 1; } else { rFrom = to - 2; rTo = from - 1; }
        rook = this.pieces.get(rFrom); this.pieces.delete(rFrom);
      }
      this.pieces.set(to, mover); mover.userData.sq = to;
      if (rook) { this.pieces.set(rTo, rook); rook.userData.sq = rTo; }

      const isKnight = (mover.userData.code & 7) === 2;
      const x0 = mover.position.x, z0 = mover.position.z, x1 = sqX(to), z1 = sqZ(to);
      const rx0 = rook ? rook.position.x : 0, rz0 = rook ? rook.position.z : 0;
      const lift = isKnight ? 1.2 : 0.55;
      const finish = () => {
        mover.position.set(x1, 0, z1);
        if (rook) rook.position.set(sqX(rTo), 0, sqZ(rTo));
        if (captured) this.scene.remove(captured);
        if (promo) {
          this.scene.remove(mover);
          const n = this._addPiece(promo | (color << 3), to);
          n.scale.setScalar(0.01);
          this.tween(0.35, k => { const s = 0.01 + 0.99 * ease(k); n.scale.setScalar(s); n.position.y = Math.sin(k * Math.PI) * 0.3; }, () => { n.scale.setScalar(1); n.position.y = 0; });
        }
      };
      if (fast) { finish(); this.setLast(from, to); return; }
      const dist = Math.hypot(x1 - x0, z1 - z0);
      const dur = 0.35 + Math.min(0.4, dist * 0.08);
      this.tween(dur, k => {
        const e = ease(k);
        mover.position.set(x0 + (x1 - x0) * e, Math.sin(Math.PI * e) * lift, z0 + (z1 - z0) * e);
        if (rook) { rook.position.set(rx0 + (sqX(rTo) - rx0) * e, Math.sin(Math.PI * e) * 0.4, rz0 + (sqZ(rTo) - rz0) * e); }
        if (captured && k > 0.75) { const s = Math.max(0.001, 1 - (k - 0.75) / 0.25); captured.scale.setScalar(s); captured.position.y = (1 - s) * -0.3; }
      }, finish);
      this.setLast(from, to);
    }

    setLast(from, to) {
      this.last = from >= 0 ? [from, to] : null;
      for (let i = 0; i < 2; i++) {
        if (this.last) this._placeFlat(this.hlLast[i], this.last[i]); else this.hlLast[i].visible = false;
      }
    }

    setSelected(sq, targets) {
      this.selected = sq;
      if (sq >= 0) this._placeFlat(this.hlSel, sq); else this.hlSel.visible = false;
      let d = 0, r = 0;
      (targets || []).forEach(t => {
        const cap = this.pieces.has(t.to) || t.ep;
        const mesh = cap ? this.rings[r++] : this.dots[d++];
        if (mesh) this._placeFlat(mesh, t.to);
      });
      for (; d < this.dots.length; d++) this.dots[d].visible = false;
      for (; r < this.rings.length; r++) this.rings[r].visible = false;
    }

    setCheck(sq) {
      this.check = sq;
      if (sq >= 0) this._placeFlat(this.hlCheck, sq); else this.hlCheck.visible = false;
    }

    /** Draw arrows for a list of {from,to,color}. */
    setArrows(list) {
      this.arrows.forEach((a, i) => {
        const d = list && list[i];
        if (!d) { a.visible = false; return; }
        const x0 = sqX(d.from), z0 = sqZ(d.from), x1 = sqX(d.to), z1 = sqZ(d.to);
        const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
        const yOff = 0.12 + i * 0.02;
        a.position.set(x0, yOff, z0);
        a.rotation.y = -Math.atan2(dz, dx);
        const shaftLen = Math.max(0.1, len - 0.55);
        a.userData.shaft.scale.set(1, shaftLen, 1);
        a.userData.shaft.position.set(shaftLen / 2 + 0.05, 0, 0);
        a.userData.head.position.set(shaftLen + 0.05 + 0.2, 0, 0);
        a.userData.mat.color.set(d.color);
        a.userData.mat.opacity = d.opacity == null ? 0.85 : d.opacity;
        a.visible = true;
      });
    }

    setPerspective(color) {
      this.userMoved = false;
      this.ctl.flyTo(new T.Vector3(0, 0, 0), this.fitRadius(), color ? Math.PI : 0, 0.92, 1.0);
    }

    render(dt) {
      this.time += dt;
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const tw = this.tweens[i];
        tw.t += dt;
        const k = Math.min(1, tw.t / tw.dur);
        tw.fn(k);
        if (k >= 1) { this.tweens.splice(i, 1); if (tw.done) tw.done(); }
      }
      if (this.hlCheck.visible) this.hlCheck.material.opacity = 0.45 + 0.3 * Math.sin(this.time * 6);
      this.ctl.update(dt);
      this.renderer.render(this.scene, this.camera);
    }
  }

  G.BoardView = BoardView;
})(window);

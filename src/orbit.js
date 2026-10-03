/* Minimal orbit / pan / zoom camera controller with damping (mouse, wheel and touch). */
(function (G) {
  'use strict';
  const T = G.THREE;

  class Orbit {
    constructor(camera, dom, o = {}) {
      this.camera = camera; this.dom = dom;
      this.target = (o.target || new T.Vector3()).clone();
      this.theta = o.theta || 0; this.phi = o.phi || 1; this.radius = o.radius || 10;
      this.minR = o.minR || 2; this.maxR = o.maxR || 100;
      this.minPhi = o.minPhi == null ? 0.05 : o.minPhi; this.maxPhi = o.maxPhi == null ? Math.PI - 0.05 : o.maxPhi;
      this.vTheta = 0; this.vPhi = 0;
      this.autoRotate = false;
      this.enabled = true;
      this.travel = 0;
      this.onUser = null;
      this.pointers = new Map();
      this.anim = null;
      this.lastPinch = 0;
      this._bind();
      this.update(0);
    }

    _bind() {
      const d = this.dom;
      d.style.touchAction = 'none';
      d.addEventListener('contextmenu', e => e.preventDefault());
      d.addEventListener('pointerdown', e => {
        if (!this.enabled) return;
        d.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey || e.ctrlKey || e.metaKey });
        if (this.pointers.size === 1) this.travel = 0;
        this.anim = null;
        if (this.pointers.size === 2) this.lastPinch = this._pinchDist();
      });
      d.addEventListener('pointermove', e => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        this.travel += Math.abs(dx) + Math.abs(dy);
        if (this.pointers.size === 1) {
          if (p.button === 0 && !p.shift) {
            this.theta -= dx * 0.0065; this.phi -= dy * 0.0065;
            this.vTheta = -dx * 0.0065; this.vPhi = -dy * 0.0065;
            this.phi = Math.min(this.maxPhi, Math.max(this.minPhi, this.phi));
          } else this._pan(dx, dy);
          if (this.onUser) this.onUser();
        } else if (this.pointers.size === 2) {
          const dist = this._pinchDist();
          if (this.lastPinch > 0) this.radius = Math.min(this.maxR, Math.max(this.minR, this.radius * this.lastPinch / dist));
          this.lastPinch = dist;
          this._pan(dx / 2, dy / 2);
          if (this.onUser) this.onUser();
        }
      });
      const up = e => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.lastPinch = 0;
      };
      d.addEventListener('pointerup', up);
      d.addEventListener('pointercancel', up);
      d.addEventListener('wheel', e => {
        if (!this.enabled) return;
        e.preventDefault();
        this.radius = Math.min(this.maxR, Math.max(this.minR, this.radius * Math.exp(e.deltaY * 0.0012)));
        this.anim = null;
        if (this.onUser) this.onUser();
      }, { passive: false });
    }

    _pinchDist() {
      const a = [...this.pointers.values()];
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
    }

    _pan(dx, dy) {
      const h = this.dom.clientHeight || 1;
      const unit = 2 * this.radius * Math.tan((this.camera.fov * Math.PI / 180) / 2) / h;
      const m = this.camera.matrixWorld.elements;
      const right = new T.Vector3(m[0], m[1], m[2]), up = new T.Vector3(m[4], m[5], m[6]);
      this.target.addScaledVector(right, -dx * unit).addScaledVector(up, dy * unit);
    }

    get dragging() { return this.pointers.size > 0; }

    /** Smoothly move to a new view. */
    flyTo(target, radius, theta, phi, secs = 0.8) {
      this.anim = {
        t: 0, dur: secs,
        from: { tx: this.target.x, ty: this.target.y, tz: this.target.z, r: this.radius, th: this.theta, ph: this.phi },
        to: { tx: target.x, ty: target.y, tz: target.z, r: radius, th: theta == null ? this.theta : theta, ph: phi == null ? this.phi : phi }
      };
      if (theta != null) { // shortest way round
        let d = this.anim.to.th - this.anim.from.th;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.anim.to.th = this.anim.from.th + d;
      }
    }

    update(dt) {
      if (this.anim) {
        const a = this.anim;
        a.t += dt;
        const k = Math.min(1, a.t / a.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const l = (x, y) => x + (y - x) * e;
        this.target.set(l(a.from.tx, a.to.tx), l(a.from.ty, a.to.ty), l(a.from.tz, a.to.tz));
        this.radius = l(a.from.r, a.to.r); this.theta = l(a.from.th, a.to.th); this.phi = l(a.from.ph, a.to.ph);
        if (k >= 1) this.anim = null;
      } else if (!this.dragging) {
        if (this.autoRotate) this.theta += dt * 0.12;
        this.theta += this.vTheta; this.phi += this.vPhi;
        this.phi = Math.min(this.maxPhi, Math.max(this.minPhi, this.phi));
        const damp = Math.pow(0.0008, dt);
        this.vTheta *= damp; this.vPhi *= damp;
        if (Math.abs(this.vTheta) < 1e-5) this.vTheta = 0;
        if (Math.abs(this.vPhi) < 1e-5) this.vPhi = 0;
      }
      const sp = Math.sin(this.phi);
      this.camera.position.set(
        this.target.x + this.radius * sp * Math.sin(this.theta),
        this.target.y + this.radius * Math.cos(this.phi),
        this.target.z + this.radius * sp * Math.cos(this.theta));
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
    }
  }

  G.Orbit = Orbit;
})(window);

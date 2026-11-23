// Lienzo de dibujo táctil con deshacer.
export class DrawPad {
  constructor(canvas, { size = 360, bg = "#ffffff" } = {}) {
    this.c = canvas;
    this.c.width = size;
    this.c.height = size;
    this.ctx = canvas.getContext("2d");
    this.bg = bg;
    this.strokes = [];
    this.cur = null;
    this.color = "#1b1b1b";
    this.width = 6;
    this.onChange = null;
    this.locked = false;
    this.base = null;
    this.redraw();

    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", () => this.up());
    canvas.addEventListener("pointercancel", () => this.up());
  }

  pos(e) {
    const r = this.c.getBoundingClientRect();
    return [(e.clientX - r.left) * this.c.width / r.width, (e.clientY - r.top) * this.c.height / r.height];
  }

  down(e) {
    if (this.locked) return;
    e.preventDefault();
    this.c.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    this.cur = { color: this.color, width: this.width, pts: [p] };
    this.strokes.push(this.cur);
    this.dot(p, this.cur);
  }

  move(e) {
    if (!this.cur) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = this.pos(ev);
      const last = this.cur.pts[this.cur.pts.length - 1];
      this.cur.pts.push(p);
      this.seg(last, p, this.cur);
    }
  }

  up() {
    if (!this.cur) return;
    this.cur = null;
    this.onChange?.();
  }

  dot(p, s) {
    const x = this.ctx;
    x.fillStyle = s.color;
    x.beginPath();
    x.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2);
    x.fill();
  }

  seg(a, b, s) {
    const x = this.ctx;
    x.strokeStyle = s.color;
    x.lineWidth = s.width;
    x.lineCap = "round";
    x.lineJoin = "round";
    x.beginPath();
    x.moveTo(a[0], a[1]);
    x.lineTo(b[0], b[1]);
    x.stroke();
  }

  redraw() {
    const x = this.ctx;
    x.fillStyle = this.bg;
    x.fillRect(0, 0, this.c.width, this.c.height);
    if (this.base) x.drawImage(this.base, 0, 0, this.c.width, this.c.height);
    for (const s of this.strokes) {
      this.dot(s.pts[0], s);
      for (let i = 1; i < s.pts.length; i++) this.seg(s.pts[i - 1], s.pts[i], s);
    }
  }

  undo() { this.strokes.pop(); this.redraw(); this.onChange?.(); }
  clear() { this.strokes = []; this.base = null; this.redraw(); this.onChange?.(); }
  isEmpty() { return this.strokes.length === 0 && !this.base; }
  /** Pinta una imagen previa debajo (p. ej. el avatar al recargar la página). */
  setBase(src) {
    if (!src) return;
    const img = new Image();
    img.onload = () => { this.base = img; this.redraw(); };
    img.src = src;
  }
  toDataURL() { return this.c.toDataURL("image/png"); }
  /** Los trazos en texto compacto, para que la tele los repinte uno a uno. Null si hay imagen de fondo. */
  toStrokes() {
    if (this.base) return null;
    const l = this.strokes.map((s) => {
      const out = [];
      let lx = -99, ly = -99;
      s.pts.forEach(([x, y], i) => {
        if (i && i < s.pts.length - 1 && Math.hypot(x - lx, y - ly) < 3) return; // aligera sin cambiar la forma
        out.push(Math.round(x), Math.round(y));
        lx = x; ly = y;
      });
      return [s.color, s.width, out];
    });
    return JSON.stringify({ s: this.c.width, l });
  }
}

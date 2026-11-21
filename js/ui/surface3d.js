import { badness, badnessColor } from '../precision.js';

// 3D surface of the last runs: notes of the scale left to right, the oldest
// run at the back and the newest at the front, height = cents sharp/flat.
// A tiny canvas renderer (rotate + project + paint far-to-near); no libraries.

const LIMIT = 50; // cents shown

// the same green / amber / red scale as the summary chart after a run
const LIGHT_SCALE = { good: [31, 138, 76], warn: [201, 138, 0], bad: [198, 47, 47] };

export class Surface3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o { runs: [{d, steps: number[]}], labels: string[], palette: {fg, muted, grid, bg}, fullCents }
   */
  constructor(canvas, o) {
    this.c = canvas;
    this.o = o;
    this.yaw = -0.55;
    this.pitch = 0.55;
    if (o.interactive !== false) this.enableDrag();
    this.draw();
  }

  enableDrag() {
    let last = null;
    const down = (e) => { last = { x: e.clientX, y: e.clientY }; this.c.setPointerCapture && this.c.setPointerCapture(e.pointerId); };
    const move = (e) => {
      if (!last) return;
      this.yaw += (e.clientX - last.x) * 0.01;
      this.pitch = Math.max(0.12, Math.min(1.35, this.pitch + (e.clientY - last.y) * 0.006));
      last = { x: e.clientX, y: e.clientY };
      this.draw();
    };
    const up = () => { last = null; };
    this.c.addEventListener('pointerdown', down);
    this.c.addEventListener('pointermove', move);
    this.c.addEventListener('pointerup', up);
    this.c.addEventListener('pointercancel', up);
  }

  draw() {
    const { runs, labels = [], palette } = this.o;
    const c = this.c;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (palette.bg && palette.bg !== 'transparent') { ctx.fillStyle = palette.bg; ctx.fillRect(0, 0, W, H); }
    const R = runs.length;
    const N = Math.min(...runs.map((r) => (r.steps || []).length));
    if (!R || !isFinite(N) || N < 2) {
      ctx.fillStyle = palette.muted;
      ctx.font = `${Math.round(H / 18)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('No runs yet', W / 2, H / 2);
      return;
    }
    // a single run is drawn as a thin ribbon
    const rows = R === 1 ? [runs[0], runs[0]] : runs;
    const Rr = rows.length;
    const val = (j, i) => { const v = rows[j].steps[i]; return v == null ? null : Math.max(-LIMIT, Math.min(LIMIT, v)); };
    // world coordinates: x ∈ [-1.4, 1.4] notes, z ∈ [-0.8, 0.8] runs (oldest back), y height
    const X = (i) => -1.4 + (2.8 * i) / (N - 1);
    const Z = (j) => (Rr === 1 ? 0 : -0.8 + (1.6 * j) / (Rr - 1));
    const Y = (v) => (v / LIMIT) * 0.55;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const scale = Math.min(W, H * 1.7) / 4.3;
    const proj = (x, y, z) => {
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp; // depth (bigger = nearer the viewer)
      return { x: W * 0.47 + x1 * scale, y: H * 0.46 - y2 * scale, z: z2 };
    };
    const lw = Math.max(1, W / 700);
    // base plane outline and the zero line grid
    ctx.lineWidth = lw;
    ctx.strokeStyle = palette.grid;
    const corners = [[X(0), Z(0)], [X(N - 1), Z(0)], [X(N - 1), Z(Rr - 1)], [X(0), Z(Rr - 1)]];
    ctx.beginPath();
    corners.forEach(([x, z], k) => { const p = proj(x, -0.55, z); if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath();
    ctx.stroke();
    // cents scale on the back-left corner
    ctx.fillStyle = palette.muted;
    ctx.font = `${Math.max(10, Math.round(W / 70))}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'right';
    for (const cv of [-50, -25, 0, 25, 50]) {
      const p = proj(X(0), Y(cv), Z(0));
      const q = proj(X(0) - 0.08, Y(cv), Z(0));
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.fillText(`${cv > 0 ? '+' : ''}${cv}¢`, q.x - 3, q.y + 4);
    }
    // quads, far to near
    const quads = [];
    if (this.o.perNote) {
      // a piece: each run is its own strip, one tile per note at that note's height and colour,
      // so every note played in a run shows and the bars not played stay blank
      const half = Rr === 1 ? 0.3 : (0.8 / (Rr - 1)) * 0.8;
      const dx = 1.4 / (N - 1);
      for (let j = 0; j < R; j++) for (let i = 0; i < N; i++) {
        const v = val(j, i);
        if (v == null) continue;
        const z = R === 1 ? 0 : Z(j), x0 = Math.max(X(0), X(i) - dx), x1 = Math.min(X(N - 1), X(i) + dx);
        const pts = [proj(x0, Y(v), z - half), proj(x1, Y(v), z - half), proj(x1, Y(v), z + half), proj(x0, Y(v), z + half)];
        quads.push({ pts, depth: pts.reduce((a, p) => a + p.z, 0) / 4, avg: Math.abs(v) });
      }
    }
    for (let j = 0; j < Rr - 1 && !this.o.perNote; j++) for (let i = 0; i < N - 1; i++) {
      const vs = [val(j, i), val(j, i + 1), val(j + 1, i + 1), val(j + 1, i)];
      if (vs.some((v) => v == null)) continue;
      const pts = [proj(X(i), Y(vs[0]), Z(j)), proj(X(i + 1), Y(vs[1]), Z(j)), proj(X(i + 1), Y(vs[2]), Z(j + 1)), proj(X(i), Y(vs[3]), Z(j + 1))];
      const depth = pts.reduce((a, p) => a + p.z, 0) / 4;
      const avg = vs.reduce((a, v) => a + Math.abs(v), 0) / 4;
      quads.push({ pts, depth, avg });
    }
    quads.sort((a, b) => a.depth - b.depth);
    const prec = this.o.prec || { fullCents: 7, zeroCents: 35 };
    const scale3 = this.o.colors || LIGHT_SCALE;
    for (const q of quads) {
      ctx.fillStyle = badnessColor(badness(q.avg, prec), scale3);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      q.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // the newest run drawn as a line on top, so the front edge is clear
    ctx.strokeStyle = palette.fg;
    ctx.lineWidth = lw * 1.5;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      const v = val(Rr - 1, i);
      if (v == null) { pen = false; continue; }
      const p = proj(X(i), Y(v), Z(Rr - 1));
      if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
    // note names along the front, run dates along the right side
    ctx.fillStyle = palette.fg;
    ctx.textAlign = 'center';
    const every = Math.max(1, Math.ceil(N / 16));
    if (labels.some((l) => l === '')) {
      // a piece: bar numbers under the first note of each bar, thinned out so they don't overlap
      let lastAt = -Infinity;
      for (let i = 0; i < N; i++) {
        if (!labels[i] || i - lastAt < every) continue;
        const p = proj(X(i), -0.62, Z(Rr - 1) + 0.12);
        ctx.fillText(labels[i], p.x, p.y + 12);
        lastAt = i;
      }
    } else {
      for (let i = 0; i < N; i += every) {
        const p = proj(X(i), -0.62, Z(Rr - 1) + 0.12);
        ctx.fillText(labels[i] || String(i + 1), p.x, p.y + 12);
      }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.muted;
    const dEvery = Math.max(1, Math.ceil(R / 5));
    runs.forEach((run, j) => {
      if (j % dEvery !== 0 && j !== R - 1) return;
      const p = proj(X(N - 1) + 0.12, -0.55, Z(R === 1 ? 0 : j));
      const d = new Date(run.d);
      ctx.fillText(`${d.getDate()}/${d.getMonth() + 1}${j === R - 1 ? ' (newest)' : ''}`, p.x + 4, p.y + 4);
    });
  }

  toDataURL() { return this.c.toDataURL('image/png'); }
}

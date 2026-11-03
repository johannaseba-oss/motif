import { STAMP_ASPECT, stampPath } from './stamp.js';
import * as store from './store.js';
import { tick } from './haptics.js';

const { PER_PAGE } = store;
const STRIPS = 10;
const LONG_PRESS = 320;
const MOVE_SLOP = 8;
const EDGE_ZONE = 34;
const EDGE_DWELL = 550;
const INK = '#000';

const PEOPLE = new Path2D('M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3.5 19c.5-3.5 2.6-5.3 5.5-5.3s5 1.8 5.5 5.3M16 5.2a3 3 0 0 1 0 5.7M17.3 13.9c1.9.6 3 2.4 3.3 5.1');
const SHARE_R = 15;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Album {
  constructor(stage, { onOpen, onShare, canMove, confirmShareDrop }) {
    this.stage = stage;
    this.onOpen = onOpen;
    this.onShare = onShare;
    this.canMove = canMove;
    this.confirmShareDrop = confirmShareDrop;
    this.cur = 0;           // aktuelle Seite (Doppelseite: immer die linke, also gerade)
    this.spread = false;
    this.pw = this.ph = 0;
    this.images = new Map(); // id -> HTMLImageElement
    this.drag = null;
    this.flip = null;
    this.gesture = null;

    stage.innerHTML = `
      <div class="book">
        <canvas class="page page-l"></canvas>
        <canvas class="page page-r"></canvas>
        <div class="cast cast-l"></div>
        <div class="cast cast-r"></div>
        <div class="leaf"></div>
      </div>`;
    this.book = stage.querySelector('.book');
    this.cl = stage.querySelector('.page-l');
    this.cr = stage.querySelector('.page-r');
    this.castL = stage.querySelector('.cast-l');
    this.castR = stage.querySelector('.cast-r');
    this.leaf = stage.querySelector('.leaf');

    this.book.addEventListener('pointerdown', e => this.down(e));
    this.book.addEventListener('pointermove', e => this.move(e));
    this.book.addEventListener('pointerup', e => this.up(e));
    this.book.addEventListener('pointercancel', e => this.cancel(e));
    this.book.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => this.layout()).observe(stage);
    this.layout();
  }

  /* ---------- Maße ---------- */

  get pageCount() { return Math.max(2, store.usedPages() + 1); }
  get step() { return this.spread ? 2 : 1; }

  layout() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const sizeKey = `${W}x${H}@${devicePixelRatio}`;
    if (sizeKey === this.sizeKey) return;
    this.sizeKey = sizeKey;
    // Drehen oder Aufklappen mitten im Blättern: Blatt verwerfen
    if (this.flip) { this.gesture = null; this.endFlip(false); }
    const SHADOW = 8;
    // Aufgeklappt (oder Tablet): beide Seiten. Sonst immer eine lange Seite.
    this.spread = W >= 620 && H >= 460;
    const availW = W - SHADOW - 2;
    const availH = H - SHADOW - 2;
    let pw = this.spread ? availW / 2 : availW;
    let ph = availH;
    if (pw > ph / 1.22) pw = ph / 1.22;
    if (ph > pw * 1.9) ph = pw * 1.9;
    this.pw = Math.floor(pw);
    this.ph = Math.floor(ph);
    this.dpr = Math.min(3, devicePixelRatio || 1);
    if (this.spread) this.cur -= this.cur % 2;

    const bookW = this.pw * (this.spread ? 2 : 1);
    Object.assign(this.book.style, {
      width: bookW + 'px', height: this.ph + 'px',
      left: Math.round((W - SHADOW - bookW) / 2) + 'px',
      top: Math.round((H - SHADOW - this.ph) / 2) + 'px',
    });
    this.book.classList.toggle('spread', this.spread);
    for (const [c, on, x] of [[this.cl, this.spread, 0], [this.cr, true, this.spread ? this.pw : 0]]) {
      c.hidden = !on;
      c.width = this.pw * this.dpr;
      c.height = this.ph * this.dpr;
      c.style.width = this.pw + 'px';
      c.style.height = this.ph + 'px';
      c.style.left = x + 'px';
    }
    Object.assign(this.leaf.style, { left: this.cr.style.left, width: this.pw + 'px', height: this.ph + 'px' });
    Object.assign(this.castR.style, { left: this.cr.style.left, width: this.pw + 'px' });
    Object.assign(this.castL.style, { left: 0, width: this.pw + 'px' });
    this.grid = this.computeGrid();
    this.render();
    this.preload();
  }

  computeGrid() {
    const { pw, ph } = this;
    const padX = pw * 0.075;
    const headH = Math.max(46, ph * 0.09);
    const padTop = headH;
    const padBottom = Math.max(30, ph * 0.065);
    const availH = ph - padTop - padBottom;
    const gapX = pw * 0.035;
    let cw = (pw - 2 * padX - 3 * gapX) / 4;
    let ch = cw / STAMP_ASPECT;
    if (ch * 4 + gapX * 3 > availH) { ch = (availH - gapX * 3) / 4; cw = ch * STAMP_ASPECT; }
    const gapY = Math.min((availH - ch * 4) / 3, cw * 0.85);
    const realGapX = (pw - 2 * padX - cw * 4) / 3;
    const top = padTop + (availH - (ch * 4 + gapY * 3)) / 2;
    const titleSize = Math.max(18, pw * 0.058);
    return { cw, ch, gapX: realGapX, gapY, padX, top, headH, titleSize };
  }

  cellRect(cell) {
    const g = this.grid;
    const c = cell % 4, r = Math.floor(cell / 4);
    return { x: g.padX + c * (g.cw + g.gapX), y: g.top + r * (g.ch + g.gapY), w: g.cw, h: g.ch };
  }

  // Seite, die gerade links (nur Doppelseite) und rechts liegt
  visiblePages() {
    return this.spread ? [this.cur, this.cur + 1] : [null, this.cur];
  }

  /* ---------- Zeichnen ---------- */

  drawPage(g, page, side, hl) {
    const { pw, ph } = this;
    g.save();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, pw, ph);

    // Weicher Falz zur Buchmitte
    const gw = pw * 0.07;
    const grad = side === 'r' ? g.createLinearGradient(0, 0, gw, 0) : g.createLinearGradient(pw, 0, pw - gw, 0);
    grad.addColorStop(0, 'rgba(0,0,0,.09)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(side === 'r' ? 0 : pw - gw, 0, gw, ph);

    if (page != null) {
      if (!this.plain) this.drawHeader(g, page);

      for (let cell = 0; cell < PER_PAGE; cell++) {
        const slot = page * PER_PAGE + cell;
        const s = store.bySlot.get(slot);
        const r = this.cellRect(cell);
        const lifted = s && (s.id === this.hiddenId || (this.drag && s === this.drag.stamp));
        const isTarget = hl === slot;
        if (s && !lifted) {
          this.drawStamp(g, s, r, isTarget ? 0.35 : 1);
        } else {
          g.save();
          g.translate(r.x, r.y);
          g.scale(r.w, r.h);
          g.lineWidth = (isTarget ? 2.2 : 1) / r.w;
          g.strokeStyle = isTarget ? INK : '#dedede';
          g.stroke(stampPath);
          g.restore();
        }
      }
      g.fillStyle = '#8a8a8a';
      g.font = `500 ${Math.max(11, pw * 0.032)}px Rubik, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(String(page + 1), pw / 2, ph - Math.max(14, ph * 0.026));
    }
    g.restore();
  }

  // Titel und Teilen-Knopf oben auf der Seite
  drawHeader(g, page) {
    const { pw } = this;
    const title = store.getPageTitle(page);
    const { padX, headH, titleSize } = this.grid;
    g.font = `900 ${titleSize}px Rubik, system-ui, sans-serif`;
    g.fillStyle = title ? INK : '#c8c8c8';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const sharedInfo = store.sharedPage(page);
    const titleText = title || (sharedInfo ? 'Gemeinsame Seite' : 'Seite benennen');
    g.fillText(titleText, padX, headH * 0.58, pw - 2 * padX - SHARE_R * 2 - 8);
    g.textBaseline = 'alphabetic';

    // Teilen-Knopf: gefüllt, wenn die Seite gemeinsam ist
    const cx = pw - padX - SHARE_R, cy = headH * 0.58;
    g.save();
    g.beginPath();
    g.arc(cx, cy, SHARE_R - 1, 0, Math.PI * 2);
    g.lineWidth = 1.6;
    g.strokeStyle = INK;
    g.fillStyle = sharedInfo ? INK : '#fff';
    g.fill();
    g.stroke();
    g.translate(cx - 9, cy - 9);
    g.scale(0.75, 0.75);
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.strokeStyle = sharedInfo ? '#fff' : INK;
    g.stroke(PEOPLE);
    g.restore();
  }

  drawStamp(g, s, r, alpha = 1) {
    const off = Math.max(1.5, r.w * 0.04);
    g.save();
    g.globalAlpha = alpha;
    g.save();
    g.translate(r.x + off, r.y + off * 1.1);
    g.scale(r.w, r.h);
    g.fillStyle = INK;
    g.fill(stampPath);
    g.restore();
    const img = this.images.get(s.id);
    if (img?.complete && img.naturalWidth) {
      g.drawImage(img, r.x, r.y, r.w, r.h);
    } else {
      g.save();
      g.translate(r.x, r.y);
      g.scale(r.w, r.h);
      g.fillStyle = '#eee';
      g.fill(stampPath);
      g.restore();
    }
    g.restore();
  }

  pageCanvas(page, side) {
    const c = document.createElement('canvas');
    c.width = this.pw * this.dpr;
    c.height = this.ph * this.dpr;
    this.drawPage(c.getContext('2d'), page, side);
    return c;
  }

  render() {
    if (!this.pw || this.flip) return;
    const [l, r] = this.visiblePages();
    const hl = this.drag?.targetSlot ?? null;
    if (this.spread) this.drawPage(this.cl.getContext('2d'), l, 'l', hl);
    this.drawPage(this.cr.getContext('2d'), r, 'r', hl);
  }

  // Vorschaubilder der aktuellen und der benachbarten Seiten laden
  preload() {
    const from = (this.cur - 2 * this.step) * PER_PAGE;
    const to = (this.cur + 3 * this.step) * PER_PAGE;
    for (const s of store.stamps) {
      if (s.slot < from || s.slot >= to || this.images.has(s.id)) continue;
      const img = new Image();
      img.src = URL.createObjectURL(s.thumb);
      this.images.set(s.id, img);
      img.onload = () => this.render();
    }
  }

  forget(id) {
    const img = this.images.get(id);
    if (img) { URL.revokeObjectURL(img.src); this.images.delete(id); }
  }

  goToSlot(slot) {
    const p = Math.floor(slot / PER_PAGE);
    this.cur = this.spread ? p - (p % 2) : p;
    this.preload();
    this.render();
  }

  clampCur() {
    const max = this.pageCount - 1;
    if (this.cur > max) this.cur = this.spread ? max - (max % 2) : max;
  }

  /* ---------- Umblättern ---------- */

  canFlip(dir) {
    return dir > 0 ? this.cur + this.step < this.pageCount : this.cur - this.step >= 0;
  }

  beginFlip(dir) {
    const { cur, spread } = this;
    let baseL = null, baseR, front, back, p0;
    if (dir > 0) {
      if (spread) { baseL = cur; baseR = cur + 3; front = cur + 1; back = cur + 2; }
      else { baseR = cur + 1; front = cur; back = null; }
      p0 = 0;
    } else {
      if (spread) { baseL = cur - 2; baseR = cur + 1; front = cur - 1; back = cur; }
      else { baseR = cur; front = cur - 1; back = null; }
      p0 = 1;
    }
    this.flip = { dir, p: p0, target: cur + dir * this.step };

    if (spread) this.drawPage(this.cl.getContext('2d'), baseL, 'l');
    this.drawPage(this.cr.getContext('2d'), baseR, 'r');
    this.buildLeaf(this.pageCanvas(front, 'r'), this.pageCanvas(back, 'l'));
    this.leaf.style.display = 'block';
    this.setProgress(p0);
  }

  // Das Blatt besteht aus ineinander gesteckten Streifen, so biegt sich das Papier
  buildLeaf(frontPage, backPage) {
    const sw = this.pw / STRIPS;
    const d = this.dpr;
    const cw = Math.ceil((sw + 0.75) * d);
    this.leaf.innerHTML = '';
    this.strips = [];
    let parent = this.leaf;
    for (let i = 0; i < STRIPS; i++) {
      const strip = document.createElement('div');
      strip.className = 'strip';
      strip.style.width = sw + 'px';
      strip.style.left = i === 0 ? '0' : sw + 'px';

      const face = (src, sx, cls) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = this.ph * d;
        c.style.width = sw + 0.75 + 'px';
        c.style.height = this.ph + 'px';
        c.className = cls;
        c.getContext('2d').drawImage(src, -sx * d, 0);
        strip.append(c);
        return c;
      };
      face(frontPage, i * sw, 'face front');
      face(backPage, this.pw - (i + 1) * sw, 'face back');
      const shadeF = document.createElement('div'); shadeF.className = 'shade front';
      const shadeB = document.createElement('div'); shadeB.className = 'shade back';
      strip.append(shadeF, shadeB);

      parent.append(strip);
      parent = strip;
      this.strips.push({ el: strip, shadeF, shadeB });
    }
  }

  setProgress(p) {
    if (!this.flip) return;
    this.flip.p = p;
    const bend = 46 * Math.sin(Math.PI * p);
    const root = -180 * p + bend;
    const delta = -bend / (STRIPS - 1);
    let angle = root;
    this.strips.forEach((s, i) => {
      if (i > 0) angle += delta;
      s.el.style.transform = `rotateY(${(i === 0 ? root : delta).toFixed(3)}deg)`;
      // Papier wird dunkler, je steiler es zum Licht steht
      const steep = Math.abs(Math.sin((angle * Math.PI) / 180));
      s.shadeF.style.opacity = (steep * 0.2).toFixed(3);
      s.shadeB.style.opacity = (steep * 0.26).toFixed(3);
    });
    const lift = Math.sin(Math.PI * p);
    this.castR.style.opacity = (p < 0.5 ? lift * 0.32 : lift * 0.16).toFixed(3);
    this.castL.style.opacity = this.spread ? (p > 0.5 ? lift * 0.32 : 0).toFixed(3) : 0;
  }

  // Blatt zu Ende führen (to = 1 weiter, to = 0 zurück)
  settleFlip(commit) {
    const f = this.flip;
    if (!f) return Promise.resolve();
    const to = (f.dir > 0) === commit ? 1 : 0;
    const from = f.p;
    const dur = 180 + 340 * Math.abs(to - from);
    return new Promise(done => {
      const t0 = performance.now();
      const frame = now => {
        const k = clamp((now - t0) / dur, 0, 1);
        const e = 1 - (1 - k) ** 3;
        this.setProgress(from + (to - from) * e);
        if (k < 1) { requestAnimationFrame(frame); return; }
        this.endFlip(commit);
        done();
      };
      requestAnimationFrame(frame);
    });
  }

  endFlip(commit) {
    if (commit) this.cur = this.flip.target;
    this.flip = null;
    this.leaf.style.display = 'none';
    this.leaf.innerHTML = '';
    this.castL.style.opacity = this.castR.style.opacity = 0;
    this.preload();
    this.render();
  }

  async turn(dir) {
    if (this.flip || !this.canFlip(dir)) return false;
    this.beginFlip(dir);
    tick();
    await this.settleFlip(true);
    return true;
  }

  /* ---------- Berührung ---------- */

  // Liefert den Platz unter dem Finger (der nächstgelegene auf der Seite) oder null
  hit(clientX, clientY) {
    const b = this.book.getBoundingClientRect();
    let x = clientX - b.left, y = clientY - b.top;
    if (x < 0 || y < 0 || x > b.width || y > b.height) return null;
    let page = this.cur;
    if (this.spread && x >= this.pw) { page = this.cur + 1; x -= this.pw; }
    let best = 0, bestD = Infinity;
    for (let c = 0; c < PER_PAGE; c++) {
      const r = this.cellRect(c);
      const d = Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2));
      if (d < bestD) { bestD = d; best = c; }
    }
    const r = this.cellRect(best);
    const inside = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    return { slot: page * PER_PAGE + best, inside };
  }

  cellClientRect(slot) {
    const page = Math.floor(slot / PER_PAGE);
    const [l, r] = this.visiblePages();
    if (page !== l && page !== r) return null;
    const b = this.book.getBoundingClientRect();
    const c = this.cellRect(slot % PER_PAGE);
    return { left: b.left + c.x + (page === l && this.spread ? 0 : this.spread ? this.pw : 0), top: b.top + c.y, width: c.w, height: c.h };
  }

  down(e) {
    if (this.gesture || this.flip || this.drag) return;
    try { this.book.setPointerCapture(e.pointerId); } catch {}
    const h = this.hit(e.clientX, e.clientY);
    const stamp = h?.inside ? store.bySlot.get(h.slot) : null;
    const g = this.gesture = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp,
      lastX: e.clientX, lastT: e.timeStamp, vx: 0, stamp, mode: 'wait', timer: 0,
    };
    if (stamp && this.canMove(stamp)) g.timer = setTimeout(() => this.pick(g), LONG_PRESS);
  }

  move(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (e.timeStamp > g.lastT) {
      g.vx = (e.clientX - g.lastX) / (e.timeStamp - g.lastT);
      g.lastX = e.clientX; g.lastT = e.timeStamp;
    }
    if (g.mode === 'drag') return this.dragMove(e.clientX, e.clientY);
    if (g.mode === 'wait' && Math.hypot(dx, dy) > MOVE_SLOP) {
      clearTimeout(g.timer);
      if (Math.abs(dx) > Math.abs(dy)) {
        const dir = dx < 0 ? 1 : -1;
        if (this.canFlip(dir)) { this.beginFlip(dir); g.mode = 'flip'; g.dir = dir; tick(); }
        else g.mode = 'none';
      } else g.mode = 'none';
    }
    if (g.mode === 'flip') {
      const travel = this.pw * 1.05;
      const p = g.dir > 0 ? clamp(-dx / travel, 0, 1) : clamp(1 - dx / travel, 0, 1);
      this.setProgress(p);
    }
  }

  up(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.timer);
    this.gesture = null;
    if (g.mode === 'drag') return this.drop(e.clientX, e.clientY);
    if (g.mode === 'flip') {
      const fast = g.dir > 0 ? g.vx < -0.35 : g.vx > 0.35;
      const far = g.dir > 0 ? this.flip.p > 0.32 : this.flip.p < 0.68;
      this.settleFlip(fast || far);
      return;
    }
    if (g.mode !== 'wait') return;
    if (g.stamp) { this.onOpen?.(g.stamp, this.cellClientRect(g.stamp.slot)); return; }
    const head = this.headAt(e.clientX, e.clientY);
    if (!head) return;
    if (head.share) { this.onShare?.(head.page); return; }
    const info = store.sharedPage(head.page);
    if (!info || this.canEditSharedTitle?.(info)) this.editTitle(head.page);
  }

  // Die aktuell sichtbare gemeinsame Seite mit freiem Platz, dorthin geht dann eine neue Aufnahme
  visibleSharedPage() {
    return this.visiblePages().find(p => p != null && store.isShared(p) && store.firstFreeSlotOnPage(p) != null) ?? null;
  }

  /* ---------- Seitentitel ---------- */

  headAt(clientX, clientY) {
    const b = this.book.getBoundingClientRect();
    let x = clientX - b.left;
    const y = clientY - b.top;
    if (x < 0 || x > b.width || y < 0 || y > this.grid.headH) return null;
    const right = this.spread && x >= this.pw;
    if (right) x -= this.pw;
    return { page: right ? this.cur + 1 : this.cur, share: x > this.pw - this.grid.padX - SHARE_R * 2 - 12 };
  }

  editTitle(page) {
    const { padX, headH, titleSize } = this.grid;
    const input = document.createElement('input');
    input.className = 'page-title-input';
    input.maxLength = 40;
    input.placeholder = 'Seite benennen';
    input.value = store.getPageTitle(page);
    input.setAttribute('aria-label', `Titel von Seite ${page + 1}`);
    const offset = this.spread && page === this.cur + 1 ? this.pw : 0;
    Object.assign(input.style, {
      left: offset + padX + 'px',
      top: headH * 0.58 - titleSize * 0.75 + 'px',
      width: this.pw - 2 * padX - SHARE_R * 2 - 8 + 'px',
      height: titleSize * 1.5 + 'px',
      fontSize: titleSize + 'px',
    });
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) input.addEventListener(type, e => e.stopPropagation());
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      input.remove();
      await store.setPageTitle(page, input.value.trim());
      this.render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    this.book.append(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  cancel(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.timer);
    this.gesture = null;
    if (g.mode === 'flip') this.settleFlip(false);
    if (g.mode === 'drag') this.drop(-1, -1);
  }

  /* ---------- Marke verschieben ---------- */

  pick(g) {
    if (this.gesture !== g || g.mode !== 'wait') return;
    g.mode = 'drag';
    tick('medium');
    const stamp = g.stamp;
    const rect = this.cellClientRect(stamp.slot);
    const ghost = new Image();
    ghost.src = this.images.get(stamp.id)?.src || '';
    ghost.className = 'ghost';
    const w = rect.width * 1.32, h = rect.height * 1.32;
    Object.assign(ghost.style, { width: w + 'px', height: h + 'px', left: 0, top: 0 });
    document.body.append(ghost);
    this.drag = { stamp, ghost, w, h, x: g.lastX, y: g.y0, origin: stamp.slot, targetSlot: stamp.slot, edgeSince: 0, edgeDir: 0 };
    this.placeGhost(g.lastX, g.y0);
    ghost.animate([{ scale: 0.76 }, { scale: 1 }], { duration: 130, easing: 'ease-out' });
    this.render();
    this.drag.timer = setInterval(() => this.checkEdge(), 90);
  }

  placeGhost(x, y) {
    const d = this.drag;
    d.ghost.style.transform = `translate(${x - d.w / 2}px,${y - d.h * 0.62}px) rotate(-3deg)`;
  }

  dragMove(x, y) {
    const d = this.drag;
    d.x = x; d.y = y;
    this.placeGhost(x, y);
    if (this.flip) return;
    const h = this.hit(x, y);
    const slot = h ? h.slot : null;
    if (slot !== d.targetSlot) {
      d.targetSlot = slot;
      if (slot != null) tick();
      this.render();
    }
  }

  // Am Rand verweilen blättert weiter
  checkEdge() {
    const d = this.drag;
    if (!d || this.flip) return;
    const b = this.book.getBoundingClientRect();
    const dir = d.x > Math.min(b.right, innerWidth) - EDGE_ZONE ? 1 : d.x < Math.max(b.left, 0) + EDGE_ZONE ? -1 : 0;
    if (dir !== d.edgeDir) { d.edgeDir = dir; d.edgeSince = performance.now(); return; }
    if (dir && this.canFlip(dir) && performance.now() - d.edgeSince > EDGE_DWELL) {
      d.edgeSince = performance.now() + 500;
      d.targetSlot = null;
      d.flipping = this.turn(dir).then(() => {
        if (this.drag) this.dragMove(this.drag.x, this.drag.y);
      });
    }
  }

  async drop(x, y) {
    const d = this.drag;
    clearInterval(d.timer);
    if (d.flipping) await d.flipping;
    const h = x >= 0 ? this.hit(x, y) : null;
    let slot = h ? h.slot : d.origin;
    const rule = store.dropRule(d.stamp, slot);
    if (!rule || (rule === 'share' && !(await this.confirmShareDrop(d.stamp)))) slot = d.origin;
    const other = store.bySlot.get(slot);
    const swap = other && other !== d.stamp ? other : null;
    tick();

    // Tauschpartner fliegt zum frei gewordenen Platz der gezogenen Marke
    const flights = [];
    const startGhost = d.ghost.getBoundingClientRect();
    const dest = this.cellClientRect(slot);
    const shownFrom = this.cellClientRect(d.origin);
    let swapGhost = null;
    if (swap) {
      const from = this.cellClientRect(slot);
      swapGhost = new Image();
      swapGhost.src = this.images.get(swap.id)?.src || '';
      swapGhost.className = 'ghost settle';
      Object.assign(swapGhost.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
      document.body.append(swapGhost);
      const to = shownFrom || { left: from.left, top: innerHeight + 200, width: from.width, height: from.height };
      flights.push(swapGhost.animate(
        [{ transform: 'none' }, { transform: `translate(${to.left - from.left}px,${to.top - from.top}px)` }],
        { duration: 240, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' }).finished);
    }
    await store.moveStamp(d.stamp, slot);
    // Beide fliegenden Marken sind solange nicht auf der Seite zu sehen
    d.targetSlot = null;
    this.hidden = new Set(swap ? [swap.id] : []);
    this.renderHidden();

    const target = dest || { left: startGhost.left, top: startGhost.top, width: startGhost.width, height: startGhost.height };
    d.ghost.style.transformOrigin = '0 0';
    flights.push(d.ghost.animate(
      [{ transform: d.ghost.style.transform },
       { transform: `translate(${target.left}px,${target.top}px) scale(${target.width / d.w})` }],
      { duration: 200, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' }).finished);
    await Promise.allSettled(flights);

    d.ghost.remove();
    swapGhost?.remove();
    this.hidden = null;
    this.drag = null;
    this.render();
  }

  renderHidden() {
    const saved = [];
    for (const id of this.hidden) {
      const img = this.images.get(id);
      if (img) { saved.push([id, img]); this.images.set(id, new Image()); }
    }
    this.render();
    for (const [id, img] of saved) this.images.set(id, img);
  }
}

/**
 * ニコニコ動画風コメントオーバーレイ。
 * Canvas 要素にコメントを右→左へアニメーションさせる。
 * pointer-events: none なのでプレイヤー操作を妨げない。
 */
export class CommentOverlay {
  #canvas;
  #ctx;
  #comments = [];
  #rafId = null;
  #lastTime = null;
  #laneCount = 10;
  #speed = 220; // px/秒
  #imageCache = new Map();
  #lastInLane = []; // 各レーンに最後に追加したコメントへの参照

  constructor(canvasElement) {
    this.#canvas = canvasElement;
    this.#ctx = canvasElement.getContext('2d');
    this.#lastInLane = new Array(this.#laneCount).fill(null);
    this.#syncSize();

    new ResizeObserver(() => this.#syncSize()).observe(canvasElement.parentElement);
    this.#startLoop();
  }

  #syncSize() {
    const p = this.#canvas.parentElement;
    this.#canvas.width = p.clientWidth;
    this.#canvas.height = p.clientHeight;
  }

  get #laneHeight() {
    return Math.floor(this.#canvas.height / this.#laneCount);
  }

  get #fontSize() {
    return Math.max(14, Math.min(22, this.#laneHeight - 6));
  }

  /** 画像をキャッシュつきで非同期ロード。未ロード時は null を返す。 */
  #getImage(url) {
    if (this.#imageCache.has(url)) return this.#imageCache.get(url);
    this.#imageCache.set(url, null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => this.#imageCache.set(url, img);
    img.onerror = () => this.#imageCache.set(url, null);
    img.src = url;
    return null;
  }

  /**
   * 重なりを最小化するレーンを選ぶ。
   * 各レーンの最後コメントの右端が画面右端より十分左にあれば空きとみなす。
   * すべて埋まっている場合は最も右端が小さい（最も進んだ）レーンを選ぶ。
   */
  #pickLane() {
    const W   = this.#canvas.width;
    const GAP = 20; // 新コメント開始前に確保したい最小間隔（px）

    let bestLane  = 0;
    let bestRight = Infinity;

    for (let i = 0; i < this.#laneCount; i++) {
      const last = this.#lastInLane[i];
      if (!last) return i; // 未使用レーンがあれば即採用

      const rightEdge = last.x + (last.textWidth ?? W);
      if (rightEdge <= W - GAP) return i; // 十分空いているレーン

      if (rightEdge < bestRight) {
        bestRight = rightEdge;
        bestLane  = i;
      }
    }

    return bestLane; // フォールバック: 最も余裕のあるレーン
  }

  /**
   * コメントをキューに追加する。
   * @param {string} text
   * @param {{ color?: string, lane?: number, avatarUrl?: string|null }} opts
   */
  addComment(text, { color = 'rgba(255,255,255,0.82)', lane = null, avatarUrl = null } = {}) {
    if (this.#canvas.width === 0 || this.#canvas.height === 0) this.#syncSize();
    if (this.#canvas.width === 0) return;
    if (avatarUrl) this.#getImage(avatarUrl); // 先行ロード

    const chosenLane = lane ?? this.#pickLane();
    const comment = {
      text,
      color,
      lane: chosenLane,
      x: this.#canvas.width,
      textWidth: null,
      avatarUrl,
    };
    this.#comments.push(comment);
    this.#lastInLane[chosenLane] = comment;
  }

  #startLoop() {
    const tick = (ts) => {
      const delta = this.#lastTime == null ? 0 : (ts - this.#lastTime) / 1000;
      this.#lastTime = ts;
      this.#update(delta);
      this.#draw();
      this.#rafId = requestAnimationFrame(tick);
    };
    this.#rafId = requestAnimationFrame(tick);
  }

  #update(delta) {
    const dx = this.#speed * delta;
    this.#comments = this.#comments.filter((c) => {
      c.x -= dx;
      return c.x + (c.textWidth ?? this.#canvas.width) > 0;
    });
  }

  #draw() {
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, width, height);

    const fs = this.#fontSize;
    const lh = this.#laneHeight;
    const av = fs; // アバターサイズ（フォントと同じ高さ）
    const ag = 4;  // アバターとテキストの隙間

    ctx.font = `bold ${fs}px 'Meiryo','Hiragino Kaku Gothic Pro',sans-serif`;
    ctx.textBaseline = 'top';

    for (const c of this.#comments) {
      const y     = c.lane * lh + Math.floor((lh - fs) / 2);
      const textX = c.avatarUrl ? c.x + av + ag : c.x;

      if (c.textWidth == null) {
        c.textWidth = ctx.measureText(c.text).width
                    + (c.avatarUrl ? av + ag : 0);
      }

      // 丸アバター
      if (c.avatarUrl) {
        const img = this.#getImage(c.avatarUrl);
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(c.x + av / 2, y + av / 2, av / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, c.x, y, av, av);
          ctx.restore();
        }
      }

      // 縁取りで可読性を確保
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth   = 3;
      ctx.lineJoin    = 'round';
      ctx.strokeText(c.text, textX, y);

      ctx.fillStyle = c.color;
      ctx.fillText(c.text, textX, y);
    }
  }

  stop() {
    if (this.#rafId != null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }
}

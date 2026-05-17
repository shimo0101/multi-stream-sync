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

  constructor(canvasElement) {
    this.#canvas = canvasElement;
    this.#ctx = canvasElement.getContext('2d');
    this.#syncSize();

    // プレイヤーのリサイズに追従してキャンバスのビットマップサイズを更新
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

  /**
   * コメントをキューに追加する。
   * @param {string} text
   * @param {{ color?: string, lane?: number }} opts
   */
  addComment(text, { color = 'rgba(255,255,255,0.82)', lane = null } = {}) {
    if (this.#canvas.width === 0 || this.#canvas.height === 0) this.#syncSize();
    if (this.#canvas.width === 0) return; // まだレイアウト未確定なら無視
    this.#comments.push({
      text,
      color,
      lane: lane ?? Math.floor(Math.random() * this.#laneCount),
      x: this.#canvas.width,
      textWidth: null,
    });
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
    ctx.font = `bold ${fs}px 'Meiryo','Hiragino Kaku Gothic Pro',sans-serif`;
    ctx.textBaseline = 'top';

    for (const c of this.#comments) {
      const y = c.lane * lh + Math.floor((lh - fs) / 2);

      if (c.textWidth == null) {
        c.textWidth = ctx.measureText(c.text).width;
      }

      // 縁取りで可読性を確保
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(c.text, c.x, y);

      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, y);
    }
  }

  stop() {
    if (this.#rafId != null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }
}

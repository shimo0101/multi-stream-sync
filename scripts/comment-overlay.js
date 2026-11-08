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
  #failedImages = new Set(); // 読み込みに失敗した画像URL（フォールバック表示の判定用）
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

  /** 画像をキャッシュつきで非同期ロード。未ロード・失敗時は null を返す。 */
  #getImage(url) {
    if (this.#imageCache.has(url)) return this.#imageCache.get(url);
    this.#imageCache.set(url, null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => this.#imageCache.set(url, img);
    img.onerror = () => { this.#imageCache.set(url, null); this.#failedImages.add(url); };
    img.src = url;
    return null;
  }

  /** スタンプ画像などを事前に読み込んでおく（チャット開始時に辞書の画像を先読みする用途） */
  preloadImages(urls) {
    for (const url of urls ?? []) if (url) this.#getImage(url);
  }

  /**
   * 本文とスタンプを、表示順に並んだ部品の配列にする。
   * stamp.at（本文中の位置）があればその位置に、無ければ末尾に置く。
   */
  static #buildSegments(text, stamps) {
    const placed = stamps
      .map((s, i) => ({ s, i, at: Number.isFinite(s.at) ? Math.min(Math.max(s.at, 0), text.length) : text.length }))
      .sort((a, b) => a.at - b.at || a.i - b.i);
    const segs = [];
    let pos = 0;
    for (const { s, at } of placed) {
      if (at > pos) segs.push({ text: text.slice(pos, at) });
      segs.push({ stamp: s });
      pos = Math.max(pos, at);
    }
    if (pos < text.length) segs.push({ text: text.slice(pos) });
    return segs;
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
   * @param {{ color?: string, lane?: number, avatarUrl?: string|null, stamps?: Array<{url: string, fallbackText?: string, at?: number}> }} opts
   *   stamps[].at: 本文中でスタンプを描く位置（文字数）。省略時は末尾
   */
  addComment(text, { color = 'rgba(255,255,255,0.82)', lane = null, avatarUrl = null, stamps = [] } = {}) {
    if (this.#canvas.width === 0 || this.#canvas.height === 0) this.#syncSize();
    if (this.#canvas.width === 0) return;
    if (avatarUrl) this.#getImage(avatarUrl); // 先行ロード
    for (const s of stamps) this.#getImage(s.url); // スタンプ画像も先行ロード

    const chosenLane = lane ?? this.#pickLane();
    const comment = {
      text,
      color,
      lane: chosenLane,
      x: this.#canvas.width,
      textWidth: null,
      avatarUrl,
      segments: CommentOverlay.#buildSegments(text ?? '', stamps),
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
    const av = fs; // アバター・スタンプのサイズ（フォントと同じ高さ）
    const ag = 4;  // 要素間の隙間

    ctx.font = `bold ${fs}px 'Meiryo','Hiragino Kaku Gothic Pro',sans-serif`;
    ctx.textBaseline = 'top';

    for (const c of this.#comments) {
      const y = c.lane * lh + Math.floor((lh - fs) / 2);

      // 横幅を計算する。スタンプは画像の読み込み状態に関係なく常にアイコン1個分の幅で数える
      // （読み込み中に長いショートカット文字を出して、届いた瞬間に縮む…という挙動を防ぐ）
      if (c.textWidth == null) {
        let w = c.avatarUrl ? av + ag : 0;
        for (const seg of c.segments) {
          w += seg.stamp ? av + ag : ctx.measureText(seg.text).width;
        }
        c.textWidth = w;
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

      let drawX = c.avatarUrl ? c.x + av + ag : c.x;
      for (const seg of c.segments) {
        if (seg.stamp) {
          // 本文中の元の位置にスタンプを描く（前後に少し隙間を空ける）
          const sx  = drawX + ag / 2;
          const img = this.#getImage(seg.stamp.url);
          if (img) {
            ctx.drawImage(img, sx, y, av, av);
          } else if (this.#failedImages.has(seg.stamp.url)) {
            // 画像が取れなかった場合は、枠内に収まる小さな印を出す（長い文字で幅が変わらないように）
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = c.color;
            ctx.beginPath();
            ctx.arc(sx + av / 2, y + av / 2, av / 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else {
            // 読み込み中: 薄い枠だけ表示しておき、届いたらそのまま画像に置き換わる
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx + 0.5, y + 0.5, av - 1, av - 1);
            ctx.restore();
          }
          drawX += av + ag;
        } else if (seg.text) {
          // 本文（縁取りで可読性を確保）
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineWidth   = 3;
          ctx.lineJoin    = 'round';
          ctx.strokeText(seg.text, drawX, y);
          ctx.fillStyle = c.color;
          ctx.fillText(seg.text, drawX, y);
          drawX += ctx.measureText(seg.text).width;
        }
      }
    }
  }

  stop() {
    if (this.#rafId != null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }
}

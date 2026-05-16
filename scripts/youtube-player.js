/**
 * YouTube IFrame Player API のラッパー。
 * API スクリプトを動的にロードし、プレイヤーの生成・再生制御を提供する。
 */
export class YouTubePlayer {
  #player = null;
  #containerId;
  #callbacks;

  /** @param {string} containerId - プレイヤーを注入する要素の id */
  constructor(containerId, { onReady = () => {}, onStateChange = () => {} } = {}) {
    this.#containerId = containerId;
    this.#callbacks = { onReady, onStateChange };
  }

  /**
   * 指定の動画IDでプレイヤーを初期化する。
   * API 未ロード時は動的に script タグを挿入してからプレイヤーを生成する。
   */
  load(videoId) {
    if (window.YT?.Player) {
      this.#createPlayer(videoId);
      return;
    }

    // グローバルコールバックをチェーン（複数インスタンスへの対応）
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      this.#createPlayer(videoId);
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }

  #createPlayer(videoId) {
    // 既存プレイヤーがあれば破棄して再生成
    this.#player?.destroy();
    this.#player = new YT.Player(this.#containerId, {
      videoId,
      playerVars: { controls: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => this.#callbacks.onReady(this),
        onStateChange: (e) => this.#callbacks.onStateChange(e.data),
      },
    });
  }

  /** 現在の再生位置（秒）を返す。未初期化時は null。 */
  getCurrentTime() {
    return this.#player?.getCurrentTime() ?? null;
  }

  /** 指定秒にシークする */
  seekTo(seconds) {
    this.#player?.seekTo(Math.max(0, seconds), true);
  }

  isReady() {
    return this.#player !== null;
  }
}

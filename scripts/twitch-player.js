/**
 * Twitch プレイヤーラッパー。
 * 2つのモードをサポートする:
 *
 *   sdk モード（デフォルト）
 *     Twitch Embed JS API を直接使用。`parent` に埋め込みページのホスト名が必要。
 *     拡張機能ページ（moz-extension://）では動作しないことが多い。
 *     → ローカルサーバー（localhost）で動作確認するか、relay モードを使うこと。
 *
 *   relay モード
 *     `relay.html` を自前ドメインにホスティングし、そのURLを relayUrl に指定する。
 *     relay.html が Twitch プレイヤーを埋め込み、postMessage で制御を中継する。
 *     → parent ドメイン制約を完全に回避できる。
 */
export class TwitchPlayer {
  #mode = 'sdk';     // 'sdk' | 'relay'
  #sdk = null;       // Twitch.Player インスタンス（sdk モード）
  #iframe = null;    // relay ページの iframe（relay モード）
  #containerId;
  #parent;
  #relayUrl;
  #callbacks;
  #cachedTime = 0;  // relay モードでの現在位置キャッシュ（1秒ごとに更新）
  #pollTimer = null;
  #msgHandler = null;

  constructor(containerId, { onReady = () => {}, parent = 'localhost', relayUrl = '' } = {}) {
    this.#containerId = containerId;
    this.#parent      = parent;
    this.#relayUrl    = relayUrl;
    this.#callbacks   = { onReady };
    this.#mode        = relayUrl ? 'relay' : 'sdk';
    if (relayUrl) this.#setupMsgListener();
  }

  load(id, type = 'channel') {
    this.#mode === 'relay' ? this.#loadRelay(id, type) : this.#loadSdk(id, type);
  }

  /** 現在の再生位置（秒）。sdk モードは即時値、relay モードは最大1秒遅延のキャッシュ値。 */
  getCurrentTime() {
    return this.#mode === 'relay'
      ? this.#cachedTime
      : (this.#sdk?.getCurrentTime() ?? null);
  }

  seekTo(seconds) {
    const t = Math.max(0, seconds);
    if (this.#mode === 'relay') {
      this.#postToRelay({ type: 'seek', data: { time: t } });
    } else {
      this.#sdk?.seek(t);
    }
  }

  isReady() {
    return this.#mode === 'relay' ? this.#iframe !== null : this.#sdk !== null;
  }

  /** sdk モードの parent ドメインを変更する。次回 load() 時に反映される。 */
  setParent(parent) {
    this.#parent = parent;
  }

  /**
   * relay URL を変更する。空文字を渡すと sdk モードに戻る。
   * 次回 load() 時に反映される。
   */
  setRelayUrl(url) {
    const wasRelay = this.#mode === 'relay';
    this.#relayUrl = url;
    this.#mode = url ? 'relay' : 'sdk';
    if (url && !wasRelay) this.#setupMsgListener();
  }

  // ===== SDK モード =====

  #loadSdk(id, type) {
    if (window.Twitch?.Player) { this.#createSdkPlayer(id, type); return; }
    const s = document.createElement('script');
    s.src = 'https://player.twitch.tv/js/embed/v1.js';
    s.onload = () => this.#createSdkPlayer(id, type);
    document.head.appendChild(s);
  }

  #createSdkPlayer(id, type) {
    const options = {
      width: '100%', height: '100%', autoplay: false,
      parent: [this.#parent],
    };
    if (type === 'channel') options.channel = id;
    else                    options.video   = id.replace(/^v/, '');

    this.#sdk = new Twitch.Player(this.#containerId, options);
    this.#sdk.addEventListener(Twitch.Player.READY, () => this.#callbacks.onReady(this));
  }

  // ===== Relay モード =====

  #setupMsgListener() {
    if (this.#msgHandler) window.removeEventListener('message', this.#msgHandler);
    this.#msgHandler = (e) => {
      if (e.data?.type === 'twitchReady') {
        this.#startTimePoll();
        this.#callbacks.onReady(this);
      } else if (e.data?.type === 'currentTime') {
        this.#cachedTime = e.data.data?.time ?? 0;
      }
    };
    window.addEventListener('message', this.#msgHandler);
  }

  #loadRelay(id, type) {
    const container = document.getElementById(this.#containerId);
    if (!container) return;

    this.#stopTimePoll();
    this.#iframe = null;
    container.innerHTML = '';

    const url = new URL(this.#relayUrl);
    if (type === 'channel') url.searchParams.set('channel', id);
    else                    url.searchParams.set('video', id);

    const iframe = document.createElement('iframe');
    iframe.src = url.toString();
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    iframe.allow = 'autoplay; fullscreen';
    container.appendChild(iframe);
    this.#iframe = iframe;
  }

  #postToRelay(msg) {
    this.#iframe?.contentWindow?.postMessage(msg, '*');
  }

  #startTimePoll() {
    this.#stopTimePoll();
    // 1秒ごとに現在位置を取得してキャッシュ（sync 機能の精度確保）
    this.#pollTimer = setInterval(() => this.#postToRelay({ type: 'getCurrentTime' }), 1000);
  }

  #stopTimePoll() {
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }
}

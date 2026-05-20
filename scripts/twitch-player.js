/**
 * Twitch プレイヤーラッパー。
 *
 *   sdk モード（デフォルト）
 *     Twitch Embed JS API を直接使用。moz-extension:// では動作しない。
 *
 *   relay モード
 *     外部サーバーの relay.html を iframe で埋め込み postMessage で制御する。
 *     Twitch の frame-ancestors CSP は background.js の webRequest で除去済み。
 */
export class TwitchPlayer {
  #mode = 'sdk';
  #sdk = null;
  #iframe = null;
  #relayReady = false;
  #containerId;
  #parent;
  #relayUrl;
  #callbacks;
  #cachedTime = 0;
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

  load(id, type = 'channel', { muted = false } = {}) {
    this.#mode === 'relay' ? this.#loadRelay(id, type, muted) : this.#loadSdk(id, type, muted);
  }

  getCurrentTime() {
    return this.#mode === 'relay'
      ? this.#cachedTime
      : (this.#sdk?.getCurrentTime() ?? null);
  }

  play() {
    if (this.#mode === 'relay') this.#postToRelay({ type: 'play' });
    else                        this.#sdk?.play();
  }

  pause() {
    if (this.#mode === 'relay') this.#postToRelay({ type: 'pause' });
    else                        this.#sdk?.pause();
  }

  seekTo(seconds) {
    const t = Math.max(0, seconds);
    if (this.#mode === 'relay') {
      this.#postToRelay({ type: 'seek', data: { time: t } });
    } else {
      this.#sdk?.seek(t);
    }
  }

  setMuted(muted) {
    if (this.#mode === 'relay') {
      this.#postToRelay({ type: muted ? 'mute' : 'unmute' });
    } else {
      this.#sdk?.setMuted(muted);
    }
  }

  isReady() {
    return this.#mode === 'relay' ? this.#relayReady : this.#sdk !== null;
  }

  setParent(parent) { this.#parent = parent; }

  setRelayUrl(url) {
    const wasRelay = this.#mode === 'relay';
    this.#relayUrl = url;
    this.#mode = url ? 'relay' : 'sdk';
    if (url && !wasRelay) this.#setupMsgListener();
  }

  // ===== SDK モード =====

  #loadSdk(id, type, muted = false) {
    if (window.Twitch?.Player) { this.#createSdkPlayer(id, type, muted); return; }
    const s = document.createElement('script');
    s.src = 'https://player.twitch.tv/js/embed/v1.js';
    s.onload = () => this.#createSdkPlayer(id, type, muted);
    document.head.appendChild(s);
  }

  #createSdkPlayer(id, type, muted = false) {
    const options = { width: '100%', height: '100%', autoplay: false, muted, parent: [this.#parent] };
    if (type === 'channel') options.channel = id;
    else                    options.video   = id.replace(/^v/, '');
    this.#sdk = new Twitch.Player(this.#containerId, options);
    this.#sdk.addEventListener(Twitch.Player.READY, () => this.#callbacks.onReady(this));
  }

  // ===== Relay モード =====

  #setupMsgListener() {
    if (this.#msgHandler) window.removeEventListener('message', this.#msgHandler);
    this.#msgHandler = (e) => {
      if (!this.#iframe || e.source !== this.#iframe.contentWindow) return;
      if (e.data?.type === 'twitchReady') {
        this.#relayReady = true;
        this.#startTimePoll();
        this.#callbacks.onReady(this);
      } else if (e.data?.type === 'currentTime') {
        this.#cachedTime = e.data.data?.time ?? 0;
      }
    };
    window.addEventListener('message', this.#msgHandler);
  }

  #loadRelay(id, type, muted = false) {
    const container = document.getElementById(this.#containerId);
    if (!container) return;

    this.#stopTimePoll();
    this.#iframe     = null;
    this.#relayReady = false;
    this.#cachedTime = 0;
    container.innerHTML = '';

    const url = new URL(this.#relayUrl);
    if (type === 'channel') url.searchParams.set('channel', id);
    else                    url.searchParams.set('video',   id);
    if (muted) url.searchParams.set('muted', '1');

    const iframe = document.createElement('iframe');
    iframe.src           = url.toString();
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    iframe.allow         = 'autoplay; fullscreen';
    container.appendChild(iframe);
    this.#iframe = iframe;
  }

  #postToRelay(msg) { this.#iframe?.contentWindow?.postMessage(msg, '*'); }

  #startTimePoll() {
    this.#stopTimePoll();
    this.#pollTimer = setInterval(() => this.#postToRelay({ type: 'getCurrentTime' }), 1000);
  }

  #stopTimePoll() {
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }
}

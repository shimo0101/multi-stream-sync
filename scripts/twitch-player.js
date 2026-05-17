/**
 * Twitch プレイヤーラッパー。
 *
 *   sdk モード（デフォルト）
 *     Twitch Embed JS API を直接使用。moz-extension:// では動作しない。
 *
 *   relay モード
 *     外部サーバーの relay.html を window.open() で開き postMessage で制御する。
 *     iframe ではなくポップアップを使う理由:
 *       Twitch が返す CSP "frame-ancestors <host>" は祖先フレーム全体をチェックするため、
 *       moz-extension:// が祖先にいると拒否される。ポップアップは祖先チェックの対象外。
 */
export class TwitchPlayer {
  #mode = 'sdk';
  #sdk = null;
  #iframe = null;           // relay iframe（後方互換用、現在は未使用）
  #popupWindow = null;      // relay popup ウィンドウ
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

  load(id, type = 'channel') {
    this.#mode === 'relay' ? this.#loadRelay(id, type) : this.#loadSdk(id, type);
  }

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
    if (this.#mode !== 'relay') return this.#sdk !== null;
    if (this.#popupWindow)      return this.#relayReady && !this.#popupWindow.closed;
    return this.#relayReady;
  }

  setParent(parent) { this.#parent = parent; }

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
    const options = { width: '100%', height: '100%', autoplay: false, parent: [this.#parent] };
    if (type === 'channel') options.channel = id;
    else                    options.video   = id.replace(/^v/, '');
    this.#sdk = new Twitch.Player(this.#containerId, options);
    this.#sdk.addEventListener(Twitch.Player.READY, () => this.#callbacks.onReady(this));
  }

  // ===== Relay モード（ポップアップウィンドウ） =====

  #setupMsgListener() {
    if (this.#msgHandler) window.removeEventListener('message', this.#msgHandler);
    this.#msgHandler = (e) => {
      if (!this.#isRelaySource(e.source)) return;
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

  #isRelaySource(source) {
    if (this.#popupWindow && !this.#popupWindow.closed) return source === this.#popupWindow;
    if (this.#iframe) return source === this.#iframe.contentWindow;
    return false;
  }

  #loadRelay(id, type) {
    // 既存ポップアップを閉じる
    if (this.#popupWindow && !this.#popupWindow.closed) this.#popupWindow.close();
    this.#popupWindow = null;
    this.#iframe      = null;

    this.#stopTimePoll();
    this.#relayReady = false;
    this.#cachedTime = 0;

    const container = document.getElementById(this.#containerId);
    if (!container) return;
    container.innerHTML = '';

    const url = new URL(this.#relayUrl);
    if (type === 'channel') url.searchParams.set('channel', id);
    else                    url.searchParams.set('video',   id);

    // iframe ではなくポップアップで開く（frame-ancestors CSP 回避）
    const popup = window.open(
      url.toString(),
      `twitch-relay-${this.#containerId}`,
      'width=960,height=540,resizable=yes,menubar=no,toolbar=no,location=no,scrollbars=no'
    );

    if (!popup) {
      container.innerHTML =
        '<p style="color:#f87171;padding:16px;font-size:13px">ポップアップがブロックされました。<br>ブラウザのアドレスバー付近の「ポップアップを許可」をクリックしてください。</p>';
      return;
    }

    this.#popupWindow = popup;

    // パネル内にプレースホルダーを表示
    container.innerHTML = `
      <div id="twitch-placeholder-${this.#containerId}"
           style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;color:#9ca3af;font-size:13px;gap:12px;
                  background:#0a0a0f;padding:16px;text-align:center;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="#6441a5">
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
        </svg>
        <span style="color:#c4b5fd;font-weight:600;">Twitch プレイヤー</span>
        <span>別ウィンドウで開いています</span>
        <button id="twitch-focus-btn-${this.#containerId}"
                style="margin-top:4px;padding:7px 16px;background:#6441a5;color:#fff;
                       border:none;border-radius:6px;cursor:pointer;font-size:13px;">
          ウィンドウを前面へ
        </button>
      </div>`;

    document.getElementById(`twitch-focus-btn-${this.#containerId}`)
      ?.addEventListener('click', () => {
        if (this.#popupWindow && !this.#popupWindow.closed) this.#popupWindow.focus();
      });
  }

  #postToRelay(msg) {
    if (this.#popupWindow && !this.#popupWindow.closed) {
      this.#popupWindow.postMessage(msg, '*');
    } else {
      this.#iframe?.contentWindow?.postMessage(msg, '*');
    }
  }

  #startTimePoll() {
    this.#stopTimePoll();
    this.#pollTimer = setInterval(() => this.#postToRelay({ type: 'getCurrentTime' }), 1000);
  }

  #stopTimePoll() {
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }
}

/**
 * YouTube relay ページ（youtube-relay/relay.html）を iframe で埋め込み、
 * postMessage で制御する YouTubePlayer。
 *
 * MV3 extension page では YouTube IFrame API スクリプトを読み込めず、
 * moz-extension:// オリジンは YouTube 埋め込みが拒否されるため、
 * 外部サーバーで配信した relay.html を経由して制御する。
 */
export class YouTubePlayer {
  #iframe = null;
  #containerId;
  #relayUrl;
  #callbacks;
  #cachedTime = 0;
  #ready = false;

  constructor(containerId, { onReady = () => {}, onStateChange = () => {}, relayUrl = '' } = {}) {
    this.#containerId = containerId;
    this.#relayUrl    = relayUrl;
    this.#callbacks   = { onReady, onStateChange };

    window.addEventListener('message', (e) => {
      if (!this.#iframe) return;
      if (e.source !== this.#iframe.contentWindow) return;
      const { type, data } = e.data || {};
      this.#handleMsg(type, data);
    });
  }

  load(videoId, { muted = false } = {}) {
    const container = document.getElementById(this.#containerId);
    if (!container) return;

    if (!this.#relayUrl) {
      container.innerHTML =
        '<p style="color:#9ca3af;padding:16px;font-size:13px">▲ ⚙ 共通設定から YouTube relay URL を設定してください</p>';
      return;
    }

    this.#ready = false;
    this.#cachedTime = 0;
    container.innerHTML = '';

    const url = new URL(this.#relayUrl);
    url.searchParams.set('v', videoId);
    if (muted) url.searchParams.set('muted', '1');

    const iframe = document.createElement('iframe');
    iframe.src           = url.toString();
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    iframe.allow         = 'autoplay; fullscreen';
    container.appendChild(iframe);
    this.#iframe = iframe;
  }

  getCurrentTime() { return this.#ready ? this.#cachedTime : null; }

  seekTo(seconds) {
    this.#post({ type: 'ytSeek', data: { time: Math.max(0, seconds) } });
  }

  setMuted(muted) {
    this.#post({ type: muted ? 'ytMute' : 'ytUnmute' });
  }

  isReady() { return this.#ready; }

  setRelayUrl(url) { this.#relayUrl = url; }

  #post(msg) { this.#iframe?.contentWindow?.postMessage(msg, '*'); }

  #handleMsg(type, data) {
    switch (type) {
      case 'ytReady':
        this.#ready = true;
        this.#callbacks.onReady(this);
        break;
      case 'ytCurrentTime':
        if (data?.time != null) this.#cachedTime = data.time;
        break;
      case 'ytStateChange':
        this.#callbacks.onStateChange(data);
        break;
    }
  }
}

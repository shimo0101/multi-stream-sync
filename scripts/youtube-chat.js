/**
 * YouTube Live Chat のポーリングクライアント。
 * YouTube Data API v3 を使用し、公開ライブチャットのメッセージを取得する。
 *
 * 必要なもの:
 *   Google Cloud Console でプロジェクトを作成し、YouTube Data API v3 を有効化した
 *   API キーを取得して設定画面に入力する。
 *
 * ポーリング間隔: API レスポンスの pollingIntervalMillis に従う（最低5秒）。
 */
export class YouTubeChatClient {
  #apiKey;
  #liveChatId = null;
  #nextPageToken = null;
  #seenIds = new Set();   // 初回取得時の既存メッセージを重複表示しない
  #timerId = null;
  #isFirstPoll = true;
  #onMessage;
  #onError;
  #onStatusChange;

  constructor({ apiKey, onMessage = () => {}, onError = () => {}, onStatusChange = () => {} }) {
    this.#apiKey = apiKey;
    this.#onMessage = onMessage;
    this.#onError = onError;
    this.#onStatusChange = onStatusChange;
  }

  /**
   * 指定動画のライブチャットを開始する。
   * ライブ配信でない場合や API キーが無効な場合は onError が呼ばれる。
   */
  async start(videoId) {
    this.stop();

    if (!this.#apiKey) {
      this.#onError('YouTube API キーが未設定です');
      return;
    }

    this.#onStatusChange('connecting');
    try {
      this.#liveChatId = await this.#fetchLiveChatId(videoId);
    } catch (err) {
      this.#onError(`API エラー: ${err.message}`);
      this.#onStatusChange('idle');
      return;
    }

    if (!this.#liveChatId) {
      this.#onError('ライブ配信が見つかりません（録画 VOD や非公開チャットは非対応）');
      this.#onStatusChange('idle');
      return;
    }

    this.#isFirstPoll = true;
    this.#onStatusChange('live');
    this.#poll();
  }

  stop() {
    clearTimeout(this.#timerId);
    this.#timerId    = null;
    this.#liveChatId  = null;
    this.#nextPageToken = null;
    this.#seenIds.clear();
    this.#onStatusChange('idle');
  }

  updateApiKey(key) {
    this.#apiKey = key;
  }

  isRunning() {
    return this.#liveChatId !== null;
  }

  // ---- private ----

  async #fetchLiveChatId(videoId) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('id', videoId);
    url.searchParams.set('part', 'liveStreamingDetails');
    url.searchParams.set('key', this.#apiKey);

    const res = await fetch(url);
    if (res.status === 403) throw new Error('API キーが無効または権限不足です');
    if (!res.ok)            throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  }

  async #poll() {
    if (!this.#liveChatId) return;

    const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
    url.searchParams.set('liveChatId', this.#liveChatId);
    url.searchParams.set('part', 'snippet,authorDetails');
    url.searchParams.set('maxResults', '200');
    url.searchParams.set('key', this.#apiKey);
    if (this.#nextPageToken) url.searchParams.set('pageToken', this.#nextPageToken);

    try {
      const res = await fetch(url);

      if (res.status === 403) {
        this.#onError('API キーが無効です。チャットを停止しました。');
        this.stop();
        return;
      }
      if (!res.ok) {
        // 一時的なエラーは10秒後に再試行
        this.#timerId = setTimeout(() => this.#poll(), 10_000);
        return;
      }

      const data = await res.json();
      this.#nextPageToken = data.nextPageToken;

      if (this.#isFirstPoll) {
        // 初回取得の既存メッセージはスキップ（画面が古いコメントで埋まらないように）
        for (const item of data.items ?? []) this.#seenIds.add(item.id);
        this.#isFirstPoll = false;
      } else {
        for (const item of data.items ?? []) {
          if (this.#seenIds.has(item.id)) continue;
          this.#seenIds.add(item.id);

          const text        = item.snippet?.displayMessage;
          const isOwner     = item.authorDetails?.isChatOwner     ?? false;
          const isModerator = item.authorDetails?.isChatModerator ?? false;
          const isMember    = item.authorDetails?.isChatSponsor   ?? false;
          const hasRole     = isOwner || isModerator || isMember;
          const avatarUrl   = hasRole
            ? (item.authorDetails?.profileImageUrl ?? null)
            : null;
          if (text) this.#onMessage({ text, isOwner, isModerator, isMember, avatarUrl });
        }
      }

      const interval = Math.max(5_000, data.pollingIntervalMillis ?? 5_000);
      this.#timerId = setTimeout(() => this.#poll(), interval);

    } catch {
      // ネットワークエラー: 15秒後に再試行
      this.#timerId = setTimeout(() => this.#poll(), 15_000);
    }
  }
}

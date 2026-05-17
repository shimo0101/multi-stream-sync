/**
 * Twitch IRC over WebSocket クライアント。
 * justinfan 匿名接続で公開チャンネルのチャットを受信する（API キー不要）。
 *
 * プロトコル:
 *   NICK justinfan{5桁乱数}
 *   JOIN #channelname
 *   PRIVMSG ← チャットメッセージ
 *   PING/PONG ← キープアライブ（4分ごとに送信）
 */
export class TwitchChatClient {
  #ws = null;
  #channel = null;
  #pingTimer = null;
  #onMessage;
  #onError;
  #onStatusChange;

  constructor({ onMessage = () => {}, onError = () => {}, onStatusChange = () => {} }) {
    this.#onMessage = onMessage;
    this.#onError = onError;
    this.#onStatusChange = onStatusChange;
  }

  /**
   * 指定チャンネルの IRC に接続する。
   * @param {string} channel - チャンネル名（# なし）
   */
  connect(channel) {
    this.disconnect();
    this.#channel = channel.toLowerCase();
    this.#onStatusChange('connecting');

    this.#ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    this.#ws.onopen = () => {
      const nick = `justinfan${Math.floor(Math.random() * 80000) + 10000}`;
      this.#send('CAP REQ :twitch.tv/tags');
      this.#send('PASS SCHMOOPIIE');
      this.#send(`NICK ${nick}`);
      this.#send(`JOIN #${this.#channel}`);
      // Twitch は PING 無応答が続くと切断するため 4 分ごとに PING を送信
      this.#pingTimer = setInterval(() => this.#send('PING :tmi.twitch.tv'), 4 * 60 * 1000);
    };

    this.#ws.onmessage = (e) => {
      for (const line of e.data.split('\r\n')) {
        this.#handleLine(line.trim());
      }
    };

    this.#ws.onerror = () => {
      this.#onError('WebSocket 接続エラー');
      this.#cleanup('idle');
    };

    this.#ws.onclose = (e) => {
      // コード 1000（正常終了）はユーザー操作によるもの = 通知不要
      if (e.code !== 1000) {
        this.#onError(`接続が切断されました（code: ${e.code}）`);
      }
      this.#cleanup('idle');
    };
  }

  disconnect() {
    if (!this.#ws) return;
    // onclose で 'idle' が呼ばれないよう先に null 化
    const ws = this.#ws;
    this.#ws = null;
    ws.onclose = null;
    ws.close(1000);
    this.#cleanup('idle');
  }

  isConnected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  // ---- private ----

  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(msg);
  }

  #handleLine(line) {
    if (!line) return;

    // サーバー PING に即 PONG
    if (line.startsWith('PING')) {
      this.#send(line.replace('PING', 'PONG'));
      return;
    }

    // 376 = End of MOTD（JOIN が完了した後に来る）→ live 状態に遷移
    if (/ 376 /.test(line) || / 001 /.test(line)) {
      this.#onStatusChange('live');
      return;
    }

    // タグ付き PRIVMSG（CAP REQ twitch.tv/tags 取得後）
    // @badge-info=...;badges=broadcaster/1,moderator/1,subscriber/0;... :nick!... PRIVMSG #ch :text
    const tagged = line.match(/^@(\S+) :\w+!\w+@\S+ PRIVMSG #\S+ :(.+)$/);
    if (tagged) {
      const [, tagStr, text] = tagged;
      const tags        = Object.fromEntries(tagStr.split(';').map(t => t.split('=')));
      const badges      = tags.badges ?? '';
      const isOwner     = badges.includes('broadcaster');
      const isModerator = badges.includes('moderator');
      const isMember    = badges.includes('subscriber') || badges.includes('founder');
      this.#onMessage({ text, isOwner, isModerator, isMember });
      return;
    }

    // タグなし PRIVMSG（フォールバック）
    const plain = line.match(/^:\w+!\w+@\S+ PRIVMSG #\S+ :(.+)$/);
    if (plain) {
      this.#onMessage({ text: plain[1], isOwner: false, isModerator: false, isMember: false });
    }
  }

  #cleanup(status) {
    clearInterval(this.#pingTimer);
    this.#pingTimer = null;
    this.#channel = null;
    this.#onStatusChange(status);
  }
}

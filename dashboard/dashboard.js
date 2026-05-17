import { YouTubePlayer }              from '../scripts/youtube-player.js';
import { TwitchPlayer }               from '../scripts/twitch-player.js';
import { CommentOverlay }             from '../scripts/comment-overlay.js';
import { SyncManager }                from '../scripts/sync-manager.js';
import { YouTubeChatClient }          from '../scripts/youtube-chat.js';
import { TwitchChatClient }           from '../scripts/twitch-chat.js';
import { loadSettings, saveSettings } from '../scripts/storage.js';

// ===== グローバル状態 =====

const syncManager = new SyncManager();
let settings = {}; // init() でロード

// ===== PanelController =====

class PanelController {
  constructor(idx) {
    this.idx           = idx;
    this.platform      = null;   // 'youtube' | 'twitch'  ※ setPlatform() で初期化
    this.loadedId      = null;   // videoId or channel name
    this.startTimeSecs = null;
    this.overlay       = new CommentOverlay(document.getElementById(`canvas-${idx}`));

    // プレイヤー・チャットは遅延生成
    this._ytPlayer = null;
    this._twPlayer = null;
    this._ytChat   = null;
    this._twChat   = null;
  }

  get player() { return this.platform === 'youtube' ? this._ytPlayer : this._twPlayer; }
  get chat()   { return this.platform === 'youtube' ? this._ytChat   : this._twChat; }

  // ----- プラットフォーム切替 -----

  setPlatform(platform) {
    if (this.platform === platform) return;

    // 旧チャットを停止
    this._ytChat?.isRunning()   && this._ytChat.stop();
    this._twChat?.isConnected() && this._twChat.disconnect();

    this.platform = platform;
    this.loadedId = null;

    // プレイヤーエリアをクリア
    document.getElementById(`player-${this.idx}`).innerHTML = '';

    // チャットボタンをリセット
    const chatBtn = document.getElementById(`btn-chat-${this.idx}`);
    chatBtn.disabled    = true;
    chatBtn.textContent = 'チャット開始';
    chatBtn.classList.remove('is-live');

    // 自動取得ボタン: YouTube のみ表示
    document.getElementById(`btn-fetch-${this.idx}`).hidden = (platform !== 'youtube');

    // チャットヒント
    document.getElementById(`chat-hint-${this.idx}`).textContent =
      platform === 'twitch' ? '匿名接続 · API Key 不要' : '';

    // プラットフォームスイッチのUIを更新
    document.querySelectorAll(`[data-panel="${this.idx}"] .plat-btn`).forEach(b =>
      b.classList.toggle('active', b.dataset.platform === platform)
    );
  }

  // ----- プレイヤー取得（なければ生成） -----

  getOrCreatePlayer() {
    if (this.platform === 'youtube') {
      if (!this._ytPlayer) {
        this._ytPlayer = new YouTubePlayer(`player-${this.idx}`, {
          onReady: () => {
            setStatus('YouTube 準備完了', 'ok');
            document.getElementById(`btn-chat-${this.idx}`).disabled = false;
          },
          relayUrl: settings.ytRelayUrl || '',
        });
      }
      return this._ytPlayer;
    } else {
      if (!this._twPlayer) {
        this._twPlayer = new TwitchPlayer(`player-${this.idx}`, {
          onReady: () => {
            setStatus('Twitch 準備完了', 'ok');
            if (this.loadedId) document.getElementById(`btn-chat-${this.idx}`).disabled = false;
          },
          parent:   settings.twParent   || 'localhost',
          relayUrl: settings.twRelayUrl || '',
        });
      }
      return this._twPlayer;
    }
  }

  // ----- チャット取得（なければ生成） -----

  getOrCreateChat() {
    if (this.platform === 'youtube') {
      if (!this._ytChat) {
        this._ytChat = new YouTubeChatClient({
          apiKey:         settings.ytApiKey || '',
          onMessage:      ({ text, author }) =>
            this.overlay.addComment(author ? `${author}: ${text}` : text),
          onError:        (msg) => setStatus(`YouTube チャットエラー: ${msg}`, 'error'),
          onStatusChange: (s)   => updateChatBtn(this.idx, s, 'YouTube'),
        });
      }
      return this._ytChat;
    } else {
      if (!this._twChat) {
        this._twChat = new TwitchChatClient({
          onMessage:      ({ text, author }) =>
            this.overlay.addComment(author ? `${author}: ${text}` : text),
          onError:        (msg) => setStatus(`Twitch チャットエラー: ${msg}`, 'error'),
          onStatusChange: (s)   => updateChatBtn(this.idx, s, 'Twitch'),
        });
      }
      return this._twChat;
    }
  }

  // ----- 読込 -----

  load(rawUrl) {
    // URLからプラットフォームを自動検出して切替
    const detected = detectPlatform(rawUrl);
    if (detected && detected !== this.platform) {
      this.setPlatform(detected);
      saveSettings({ [`p${this.idx}Platform`]: detected });
    }

    const player = this.getOrCreatePlayer();

    if (this.platform === 'youtube') {
      const videoId = parseYouTubeId(rawUrl);
      if (!videoId) { setStatus('YouTube: 有効なURLまたは動画IDを入力してください', 'error'); return; }
      this._ytChat?.isRunning() && this._ytChat.stop();
      document.getElementById(`btn-chat-${this.idx}`).disabled = true;
      this.loadedId = videoId;
      player.load(videoId);
      syncManager.registerPlayer(`p${this.idx}`, player);
      setStatus(`YouTube: "${videoId}" を読み込み中…`);
    } else {
      const parsed = parseTwitchInput(rawUrl);
      if (!parsed) { setStatus('Twitch: 有効なチャンネル名またはVOD URLを入力してください', 'error'); return; }
      if (!settings.twRelayUrl) {
        const container = document.getElementById(`player-${this.idx}`);
        container.innerHTML =
          '<p style="color:#9ca3af;padding:16px;font-size:13px">▲ ⚙ 共通設定から Twitch relay URL を設定してください<br>例: http://localhost:8080/twitch-relay/relay.html</p>';
        setStatus('Twitch: relay URL が未設定です。⚙ 共通設定を開いて設定してください', 'error');
        return;
      }
      this._twChat?.isConnected() && this._twChat.disconnect();
      document.getElementById(`btn-chat-${this.idx}`).disabled = true;
      this.loadedId = parsed.type === 'channel' ? parsed.id : null;
      player.load(parsed.id, parsed.type);
      syncManager.registerPlayer(`p${this.idx}`, player);
      const label = parsed.type === 'channel' ? 'チャンネル' : 'VOD';
      setStatus(`Twitch: ${label} "${parsed.id}" を読み込み中…`);
    }
  }

  // ----- 配信開始時刻の微調整 -----

  adjustStartTime(deltaSecs) {
    if (this.startTimeSecs == null) {
      setStatus(`プレイヤー${this.idx + 1}の配信開始時刻を先に入力するか「⬇ 自動」で取得してください`, 'error');
      return;
    }
    const newSecs = Math.max(0, this.startTimeSecs + deltaSecs);
    this.startTimeSecs = newSecs;
    const hms = formatHMS(newSecs);
    document.getElementById(`start-${this.idx}`).value = hms;
    syncManager.setStartTime(`p${this.idx}`, hms);
    saveSettings({ [`p${this.idx}Start`]: hms });
  }
}

// ===== パネルインスタンス =====

const panels = [new PanelController(0), new PanelController(1)];

// ===== ユーティリティ =====

function setStatus(msg, type = 'info') {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.color = type === 'error' ? '#f87171'
                 : type === 'ok'    ? '#4ade80'
                 : '#9ca3af';
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el && val) el.value = val;
}

function updateChatBtn(panelIdx, status, platformName) {
  const btn = document.getElementById(`btn-chat-${panelIdx}`);
  if (status === 'live') {
    btn.textContent = 'チャット停止';
    btn.classList.add('is-live');
    setStatus(`${platformName} チャット受信中`, 'ok');
  } else if (status === 'connecting') {
    btn.textContent = '接続中…';
    btn.classList.remove('is-live');
  } else {
    btn.textContent = 'チャット開始';
    btn.classList.remove('is-live');
  }
}

function detectPlatform(raw) {
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith('youtu.be') || url.hostname.includes('youtube.com')) return 'youtube';
    if (url.hostname.includes('twitch.tv')) return 'twitch';
  } catch {}
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return 'youtube'; // YouTube 動画ID
  if (/^[A-Za-z0-9_]{1,25}$/.test(raw)) return 'twitch';  // Twitch チャンネル名
  return null;
}

function parseYouTubeId(raw) {
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith('youtu.be'))
      return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.includes('youtube.com'))
      return url.searchParams.get('v')
        || url.pathname.match(/\/(live|shorts|embed)\/([A-Za-z0-9_-]{11})/)?.[2]
        || null;
  } catch {}
  return null;
}

function parseTwitchInput(raw) {
  try {
    const url = new URL(raw);
    if (url.hostname.includes('twitch.tv')) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'videos') return { id: parts[1], type: 'video' };
      if (parts[0])              return { id: parts[0], type: 'channel' };
    }
  } catch {}
  if (/^[A-Za-z0-9_]{1,25}$/.test(raw)) return { id: raw, type: 'channel' };
  return null;
}

function formatHMS(totalSecs) {
  const t = Math.floor(Math.abs(totalSecs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseHMS(str) {
  if (!str?.trim()) return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [h, m, s] = parts;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

// ===== YouTube 配信開始時刻の自動取得 =====

async function fetchYouTubeStartTime(videoId, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('id', videoId);
  url.searchParams.set('part', 'liveStreamingDetails');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (res.status === 403) throw new Error('API キーが無効または権限不足です');
  if (!res.ok)            throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const ld = data.items?.[0]?.liveStreamingDetails;
  if (!ld) return { time: null, type: 'none' };

  // actualStartTime（アーカイブ・放送中）→ scheduledStartTime（配信予定）の順にフォールバック
  const startTime = ld.actualStartTime ?? ld.scheduledStartTime ?? null;
  if (!startTime) return { time: null, type: 'none' };

  const isScheduled = !ld.actualStartTime && !!ld.scheduledStartTime;

  // ISO 8601 UTC → ユーザーのローカル時刻の HH:MM:SS
  // new Date() は自動的にシステムタイムゾーンで解釈するため JST 環境では正しい時刻になる
  const d = new Date(startTime);
  if (isNaN(d.getTime())) return { time: null, type: 'none' };
  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
  return { time: hms, type: isScheduled ? 'scheduled' : 'actual', raw: startTime };
}

// ===== 初期化 =====

async function init() {
  settings = await loadSettings();

  // GitHub Pages で動作中の場合、relay URL をリポジトリ内の相対パスで自動設定
  if (location.hostname.endsWith('github.io') && !settings.ytRelayUrl && !settings.twRelayUrl) {
    const parts   = location.pathname.split('/');          // ['','repo','dashboard','dashboard.html']
    const repoBase = location.origin + '/' + parts[1] + '/'; // 'https://xxx.github.io/repo/'
    settings.ytRelayUrl = repoBase + 'youtube-relay/relay.html';
    settings.twRelayUrl = repoBase + 'twitch-relay/relay.html';
    settings.twParent   = location.hostname;
    await saveSettings({
      ytRelayUrl: settings.ytRelayUrl,
      twRelayUrl: settings.twRelayUrl,
      twParent:   settings.twParent,
    });
  }

  // 共通設定フォームを復元
  setValue('yt-api-key',  settings.ytApiKey);
  setValue('yt-relay-url', settings.ytRelayUrl);
  setValue('tw-parent',   settings.twParent);
  setValue('tw-relay-url', settings.twRelayUrl);

  // 各パネルを復元
  [0, 1].forEach(i => {
    const platform = settings[`p${i}Platform`] || (i === 0 ? 'youtube' : 'twitch');
    panels[i].setPlatform(platform);

    setValue(`url-${i}`,   settings[`p${i}Url`]);
    setValue(`start-${i}`, settings[`p${i}Start`]);

    const secs = parseHMS(settings[`p${i}Start`]);
    if (secs !== null) {
      panels[i].startTimeSecs = secs;
      syncManager.setStartTime(`p${i}`, settings[`p${i}Start`]);
    }
  });

  // レイアウト
  vertical = settings.layout === 'vertical' || window.matchMedia('(max-width: 640px)').matches;
  applyLayout(vertical);
}

// ===== イベントリスナー =====

// --- プラットフォームスイッチ ---
document.querySelectorAll('.plat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const idx      = Number(btn.closest('[data-panel]').dataset.panel);
    const platform = btn.dataset.platform;
    panels[idx].setPlatform(platform);
    saveSettings({ [`p${idx}Platform`]: platform });
  });
});

// --- 各パネルのイベント ---
[0, 1].forEach(i => {

  // URL 入力: タイプ中にプラットフォームスイッチのプレビューを更新
  document.getElementById(`url-${i}`).addEventListener('input', (e) => {
    const detected = detectPlatform(e.target.value.trim());
    if (detected) {
      document.querySelectorAll(`[data-panel="${i}"] .plat-btn`).forEach(b =>
        b.classList.toggle('active', b.dataset.platform === detected)
      );
    }
  });

  // 読込ボタン
  document.getElementById(`btn-load-${i}`).addEventListener('click', () => {
    const raw = document.getElementById(`url-${i}`).value.trim();
    if (!raw) return;
    panels[i].load(raw);
    saveSettings({ [`p${i}Url`]: raw });
  });

  // 配信開始時刻 入力
  document.getElementById(`start-${i}`).addEventListener('change', (e) => {
    const secs = parseHMS(e.target.value);
    const ok   = secs !== null;
    e.target.classList.toggle('invalid', !ok && e.target.value !== '');
    if (ok) {
      panels[i].startTimeSecs = secs;
      syncManager.setStartTime(`p${i}`, e.target.value.trim());
      saveSettings({ [`p${i}Start`]: e.target.value.trim() });
    }
  });

  // 配信開始時刻 自動取得ボタン（YouTube のみ）
  document.getElementById(`btn-fetch-${i}`).addEventListener('click', async () => {
    const panel  = panels[i];
    if (panel.platform !== 'youtube' || !panel.loadedId) {
      setStatus('先に YouTube 動画を読み込んでください', 'error');
      return;
    }
    const apiKey = document.getElementById('yt-api-key').value.trim();
    if (!apiKey) {
      setStatus('⚙ 共通設定に YouTube API Key を入力してください', 'error');
      return;
    }
    setStatus('配信開始時刻を取得中…');
    try {
      const result = await fetchYouTubeStartTime(panel.loadedId, apiKey);
      if (!result.time) {
        setStatus('配信開始時刻を取得できませんでした（ライブ配信・アーカイブ動画のみ対応）', 'error');
        return;
      }
      const hms  = result.time;
      const label = result.type === 'scheduled' ? '配信予定時刻' : '配信開始時刻';
      document.getElementById(`start-${i}`).value = hms;
      const secs = parseHMS(hms);
      panels[i].startTimeSecs = secs;
      syncManager.setStartTime(`p${i}`, hms);
      saveSettings({ [`p${i}Start`]: hms });
      setStatus(`${label}を取得: ${hms}（元データ UTC: ${result.raw}）`, 'ok');
    } catch (err) {
      setStatus(`取得エラー: ${err.message}`, 'error');
    }
  });

  // 微調整ボタン（±1s / ±5s）
  document.querySelectorAll(`.btn--ft[data-panel="${i}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      panels[i].adjustStartTime(Number(btn.dataset.delta));
    });
  });

  // チャットボタン
  document.getElementById(`btn-chat-${i}`).addEventListener('click', () => {
    const panel = panels[i];
    const chat  = panel.getOrCreateChat();

    if (panel.platform === 'youtube') {
      if (chat.isRunning()) { chat.stop(); return; }
      if (!panel.loadedId) { setStatus('先に YouTube 動画を読み込んでください', 'error'); return; }
      chat.updateApiKey(document.getElementById('yt-api-key').value.trim());
      chat.start(panel.loadedId);
    } else {
      if (chat.isConnected()) { chat.disconnect(); return; }
      if (!panel.loadedId)   { setStatus('先に Twitch チャンネルを読み込んでください', 'error'); return; }
      chat.connect(panel.loadedId);
    }
  });
});

// --- 共通設定 ---

document.getElementById('yt-api-key').addEventListener('change', (e) => {
  settings.ytApiKey = e.target.value.trim();
  saveSettings({ ytApiKey: settings.ytApiKey });
  panels.forEach(p => p._ytChat?.updateApiKey(settings.ytApiKey));
});

document.getElementById('yt-relay-url').addEventListener('change', (e) => {
  settings.ytRelayUrl = e.target.value.trim();
  saveSettings({ ytRelayUrl: settings.ytRelayUrl });
  panels.forEach(p => p._ytPlayer?.setRelayUrl(settings.ytRelayUrl));
  setStatus(settings.ytRelayUrl
    ? `YouTube relay: ${settings.ytRelayUrl}`
    : 'YouTube relay URL が未設定です', settings.ytRelayUrl ? 'ok' : 'error');
});

document.getElementById('tw-parent').addEventListener('change', (e) => {
  settings.twParent = e.target.value.trim() || 'localhost';
  saveSettings({ twParent: settings.twParent });
  panels.forEach(p => p._twPlayer?.setParent(settings.twParent));
});

document.getElementById('tw-relay-url').addEventListener('change', (e) => {
  settings.twRelayUrl = e.target.value.trim();
  saveSettings({ twRelayUrl: settings.twRelayUrl });
  panels.forEach(p => p._twPlayer?.setRelayUrl(settings.twRelayUrl));
});

// --- ⚙ 共通設定トグル ---
document.getElementById('btn-settings').addEventListener('click', () => {
  const el    = document.getElementById('global-settings');
  const btn   = document.getElementById('btn-settings');
  el.hidden   = !el.hidden;
  btn.classList.toggle('is-open', !el.hidden);
});

// --- 同期方向トグル ---
let syncReverse = false; // false = p0→p1, true = p1→p0

document.getElementById('btn-sync-dir').addEventListener('click', () => {
  syncReverse = !syncReverse;
  document.getElementById('btn-sync-dir').textContent = syncReverse ? '2→1' : '1→2';
});

// --- 同期ボタン（同期元の現在位置を基準に同期先を一度だけシーク） ---
document.getElementById('btn-sync').addEventListener('click', () => {
  const [refIdx, tgtIdx] = syncReverse ? [1, 0] : [0, 1];
  const refPanel = panels[refIdx];
  const tgtPanel = panels[tgtIdx];
  const refNum   = refIdx + 1;
  const tgtNum   = tgtIdx + 1;

  if (!refPanel.player?.isReady()) {
    setStatus(`プレイヤー${refNum}が未準備です（動画を読み込んで再生してください）`, 'error'); return;
  }
  if (!tgtPanel.player?.isReady()) {
    setStatus(`プレイヤー${tgtNum}が未準備です（動画を読み込んで再生してください）`, 'error'); return;
  }
  if (refPanel.startTimeSecs == null) {
    setStatus(`プレイヤー${refNum}の配信開始時刻が未設定です`, 'error'); return;
  }
  if (tgtPanel.startTimeSecs == null) {
    setStatus(`プレイヤー${tgtNum}の配信開始時刻が未設定です`, 'error'); return;
  }

  const refPos = refPanel.player.getCurrentTime();
  if (refPos === null) {
    setStatus('再生位置を取得できませんでした（しばらく再生してから再試行してください）', 'error'); return;
  }

  const realTimeSecs = refPanel.startTimeSecs + refPos;
  const targetPos    = realTimeSecs - tgtPanel.startTimeSecs;

  if (targetPos < 0) {
    setStatus(`同期先はまだその時刻に達していません（${formatHMS(Math.abs(targetPos))} 前）`, 'error'); return;
  }

  tgtPanel.player.seekTo(targetPos);
  setStatus(`同期完了 ─ プレイヤー${tgtNum} を ${formatHMS(targetPos)} にシークしました`, 'ok');
});

// --- レイアウト切替 ---
const stage = document.getElementById('stage');
let vertical = false;

document.getElementById('btn-layout').addEventListener('click', () => {
  vertical = !vertical;
  applyLayout(vertical);
  saveSettings({ layout: vertical ? 'vertical' : 'horizontal' });
});

window.matchMedia('(max-width: 640px)').addEventListener('change', (e) => {
  if (e.matches && !vertical) { vertical = true; applyLayout(true); }
});

function applyLayout(vert) {
  stage.classList.toggle('layout-vertical', vert);
  document.getElementById('btn-layout').textContent = vert ? '⇄ 横並び' : '↕ 縦並び';
}

// ===== デモコメント =====
const DEMO_COMMENTS = ['w','ｗｗｗ','すごい！','GG','ナイス！','おつ！','えっ！？','笑','神','優勝！'];
let demoTimer = null;

export function startDemoComments() {
  if (demoTimer) return;
  demoTimer = setInterval(() => {
    const text  = DEMO_COMMENTS[Math.floor(Math.random() * DEMO_COMMENTS.length)];
    const color = `hsl(${Math.random() * 360},90%,70%)`;
    panels.forEach(p => { if (Math.random() > 0.4) p.overlay.addComment(text, { color }); });
  }, 700);
}

export function stopDemoComments() {
  clearInterval(demoTimer);
  demoTimer = null;
}

init().catch(console.error);

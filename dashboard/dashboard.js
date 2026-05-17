import { YouTubePlayer }              from '../scripts/youtube-player.js';
import { TwitchPlayer }               from '../scripts/twitch-player.js';
import { CommentOverlay }             from '../scripts/comment-overlay.js';
import { SyncManager }                from '../scripts/sync-manager.js';
import { YouTubeChatClient }          from '../scripts/youtube-chat.js';
import { TwitchChatClient }           from '../scripts/twitch-chat.js';
import { loadSettings, saveSettings } from '../scripts/storage.js';

// ===== グローバル状態 =====

const syncManager = new SyncManager();
let settings = {};
let panels   = [];      // PanelController[]
let syncRefIdx = 0;     // 同期基準パネルのインデックス

// ===== レイアウト定義 =====

const LAYOUT_OPTIONS = {
  1: [{ id: 'lp1',   label: '全画面' }],
  2: [
    { id: 'lp2-h', label: '横並び' },
    { id: 'lp2-v', label: '縦並び' },
  ],
  3: [
    { id: 'lp3-h', label: '横3列' },
    { id: 'lp3-v', label: '縦3段' },
    { id: 'lp3-l', label: '左大＋右2段' },
    { id: 'lp3-r', label: '左2段＋右大' },
  ],
  4: [
    { id: 'lp4-g', label: '2×2' },
    { id: 'lp4-h', label: '横4列' },
    { id: 'lp4-v', label: '縦4段' },
  ],
};

let currentLayout = 'lp2-h';

// ===== パネル HTML テンプレート =====

function createPanelHTML(idx) {
  return `
    <section class="panel" id="panel-${idx}" aria-label="プレイヤー ${idx + 1}">
      <div class="panel-config">
        <div class="config-row">
          <div class="platform-switch" data-panel="${idx}">
            <button class="plat-btn plat-btn--yt active" data-platform="youtube">YouTube</button>
            <button class="plat-btn plat-btn--tw"        data-platform="twitch">Twitch</button>
          </div>
          <input type="text" id="url-${idx}" class="input input--url"
                 placeholder="URL を入力（自動判別）" autocomplete="off">
          <button id="btn-load-${idx}" class="btn btn--load">読込</button>
        </div>
        <div class="config-row">
          <label class="config-label" for="start-${idx}">配信開始</label>
          <input type="text" id="start-${idx}" class="input input--time"
                 placeholder="HH:MM:SS" inputmode="numeric">
          <button id="btn-fetch-${idx}" class="btn btn--fetch"
                  title="YouTube APIから自動取得">⬇ 自動</button>
          <div class="finetune-group" aria-label="開始時刻の微調整">
            <button class="btn btn--ft" data-panel="${idx}" data-delta="-5">−5s</button>
            <button class="btn btn--ft" data-panel="${idx}" data-delta="-1">−1s</button>
            <button class="btn btn--ft" data-panel="${idx}" data-delta="1">+1s</button>
            <button class="btn btn--ft" data-panel="${idx}" data-delta="5">+5s</button>
          </div>
        </div>
        <div class="config-row">
          <button id="btn-chat-${idx}" class="btn btn--chat" disabled>チャット開始</button>
          <span id="chat-hint-${idx}" class="hint"></span>
        </div>
      </div>
      <div class="player-wrap">
        <div id="player-${idx}" class="player-target"></div>
        <canvas id="canvas-${idx}" class="comment-layer" aria-hidden="true"></canvas>
      </div>
    </section>`;
}

// ===== PanelController =====

class PanelController {
  constructor(idx) {
    this.idx           = idx;
    this.platform      = null;
    this.loadedId      = null;
    this.startTimeSecs = null;
    this.overlay       = new CommentOverlay(document.getElementById(`canvas-${idx}`));

    this._ytPlayer = null;
    this._twPlayer = null;
    this._ytChat   = null;
    this._twChat   = null;
  }

  get player() { return this.platform === 'youtube' ? this._ytPlayer : this._twPlayer; }
  get chat()   { return this.platform === 'youtube' ? this._ytChat   : this._twChat; }

  setPlatform(platform) {
    if (this.platform === platform) return;

    this._ytChat?.isRunning()   && this._ytChat.stop();
    this._twChat?.isConnected() && this._twChat.disconnect();

    this.platform = platform;
    this.loadedId = null;

    document.getElementById(`player-${this.idx}`).innerHTML = '';

    const chatBtn = document.getElementById(`btn-chat-${this.idx}`);
    chatBtn.disabled    = true;
    chatBtn.textContent = 'チャット開始';
    chatBtn.classList.remove('is-live');

    document.getElementById(`btn-fetch-${this.idx}`).hidden = (platform !== 'youtube');

    document.getElementById(`chat-hint-${this.idx}`).textContent =
      platform === 'twitch' ? '匿名接続 · API Key 不要' : '';

    document.querySelectorAll(`[data-panel="${this.idx}"] .plat-btn`).forEach(b =>
      b.classList.toggle('active', b.dataset.platform === platform)
    );
  }

  getOrCreatePlayer() {
    if (this.platform === 'youtube') {
      if (!this._ytPlayer) {
        this._ytPlayer = new YouTubePlayer(`player-${this.idx}`, {
          onReady: () => {
            setStatus(`P${this.idx + 1} YouTube 準備完了`, 'ok');
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
            setStatus(`P${this.idx + 1} Twitch 準備完了`, 'ok');
            if (this.loadedId) document.getElementById(`btn-chat-${this.idx}`).disabled = false;
          },
          parent:   settings.twParent   || 'localhost',
          relayUrl: settings.twRelayUrl || '',
        });
      }
      return this._twPlayer;
    }
  }

  getOrCreateChat() {
    if (this.platform === 'youtube') {
      if (!this._ytChat) {
        this._ytChat = new YouTubeChatClient({
          apiKey:         settings.ytApiKey || '',
          onMessage:      ({ text, author }) =>
            this.overlay.addComment(author ? `${author}: ${text}` : text),
          onError:        (msg) => setStatus(`P${this.idx + 1} YouTube チャットエラー: ${msg}`, 'error'),
          onStatusChange: (s)   => updateChatBtn(this.idx, s, 'YouTube'),
        });
      }
      return this._ytChat;
    } else {
      if (!this._twChat) {
        this._twChat = new TwitchChatClient({
          onMessage:      ({ text, author }) =>
            this.overlay.addComment(author ? `${author}: ${text}` : text),
          onError:        (msg) => setStatus(`P${this.idx + 1} Twitch チャットエラー: ${msg}`, 'error'),
          onStatusChange: (s)   => updateChatBtn(this.idx, s, 'Twitch'),
        });
      }
      return this._twChat;
    }
  }

  load(rawUrl) {
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
      setStatus(`P${this.idx + 1} YouTube: "${videoId}" を読み込み中…`);
    } else {
      const parsed = parseTwitchInput(rawUrl);
      if (!parsed) { setStatus('Twitch: 有効なチャンネル名またはVOD URLを入力してください', 'error'); return; }
      if (!settings.twRelayUrl) {
        document.getElementById(`player-${this.idx}`).innerHTML =
          '<p style="color:#9ca3af;padding:16px;font-size:13px">▲ ⚙ 共通設定から Twitch relay URL を設定してください</p>';
        setStatus('Twitch: relay URL が未設定です', 'error');
        return;
      }
      this._twChat?.isConnected() && this._twChat.disconnect();
      document.getElementById(`btn-chat-${this.idx}`).disabled = true;
      this.loadedId = parsed.type === 'channel' ? parsed.id : null;
      player.load(parsed.id, parsed.type);
      syncManager.registerPlayer(`p${this.idx}`, player);
      setStatus(`P${this.idx + 1} Twitch: "${parsed.id}" を読み込み中…`);
    }
  }

  adjustStartTime(deltaSecs) {
    if (this.startTimeSecs == null) {
      setStatus(`P${this.idx + 1} の配信開始時刻を先に設定してください`, 'error');
      return;
    }
    const newSecs = Math.max(0, this.startTimeSecs + deltaSecs);
    this.startTimeSecs = newSecs;
    const hms = formatHMS(newSecs);
    document.getElementById(`start-${this.idx}`).value = hms;
    syncManager.setStartTime(`p${this.idx}`, hms);
    saveSettings({ [`p${this.idx}Start`]: hms });
  }

  destroy() {
    this._ytChat?.isRunning()   && this._ytChat.stop();
    this._twChat?.isConnected() && this._twChat.disconnect();
  }
}

// ===== パネル追加 / 削除 =====

function addPanel() {
  if (panels.length >= 4) { setStatus('パネルは最大4つまでです', 'error'); return; }
  const idx = panels.length;
  document.getElementById('stage').insertAdjacentHTML('beforeend', createPanelHTML(idx));

  const p = new PanelController(idx);
  panels.push(p);

  const defaultPlat = (idx === 1) ? 'twitch' : 'youtube';
  p.setPlatform(defaultPlat);

  bindPanelEvents(idx);
  refreshLayoutSelector();
  refreshSyncRefSelector();
  applyLayout(bestLayoutForCount(panels.length));
  saveSettings({ panelCount: panels.length });
}

function removePanel() {
  if (panels.length <= 1) { setStatus('パネルは最低1つ必要です', 'error'); return; }
  const idx = panels.length - 1;
  panels.pop().destroy();
  document.getElementById(`panel-${idx}`)?.remove();

  if (syncRefIdx >= panels.length) {
    syncRefIdx = panels.length - 1;
    saveSettings({ syncRefIdx });
  }

  refreshLayoutSelector();
  refreshSyncRefSelector();
  applyLayout(bestLayoutForCount(panels.length));
  saveSettings({ panelCount: panels.length });
}

// 枚数変更時にレイアウトが無効になった場合の既定値
function bestLayoutForCount(n) {
  const options = LAYOUT_OPTIONS[n] ?? [];
  const valid   = options.map(o => o.id);
  return valid.includes(currentLayout) ? currentLayout : (options[0]?.id ?? 'lp2-h');
}

// ===== レイアウト =====

function refreshLayoutSelector() {
  const sel     = document.getElementById('sel-layout');
  const options = LAYOUT_OPTIONS[panels.length] ?? [];
  sel.innerHTML = options.map(o =>
    `<option value="${o.id}"${o.id === currentLayout ? ' selected' : ''}>${o.label}</option>`
  ).join('');
}

function applyLayout(layoutId) {
  const stage = document.getElementById('stage');
  stage.className = `stage ${layoutId}`;
  currentLayout = layoutId;
  document.getElementById('sel-layout').value = layoutId;
  saveSettings({ layout: layoutId });
}

// ===== 同期基準セレクター =====

function refreshSyncRefSelector() {
  const sel = document.getElementById('sel-sync-ref');
  sel.innerHTML = panels.map((_, i) =>
    `<option value="${i}"${i === syncRefIdx ? ' selected' : ''}>P${i + 1} 基準</option>`
  ).join('');
}

// ===== イベント バインド（パネル生成後に呼ぶ） =====

function bindPanelEvents(idx) {
  // プラットフォームスイッチ
  document.querySelectorAll(`[data-panel="${idx}"] .plat-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      panels[idx].setPlatform(btn.dataset.platform);
      saveSettings({ [`p${idx}Platform`]: btn.dataset.platform });
    });
  });

  // URL 入力プレビュー
  document.getElementById(`url-${idx}`).addEventListener('input', (e) => {
    const detected = detectPlatform(e.target.value.trim());
    if (detected) {
      document.querySelectorAll(`[data-panel="${idx}"] .plat-btn`).forEach(b =>
        b.classList.toggle('active', b.dataset.platform === detected)
      );
    }
  });

  // 読込ボタン
  document.getElementById(`btn-load-${idx}`).addEventListener('click', () => {
    const raw = document.getElementById(`url-${idx}`).value.trim();
    if (!raw) return;
    panels[idx].load(raw);
    saveSettings({ [`p${idx}Url`]: raw });
  });

  // 配信開始時刻
  document.getElementById(`start-${idx}`).addEventListener('change', (e) => {
    const secs = parseHMS(e.target.value);
    const ok   = secs !== null;
    e.target.classList.toggle('invalid', !ok && e.target.value !== '');
    if (ok) {
      panels[idx].startTimeSecs = secs;
      syncManager.setStartTime(`p${idx}`, e.target.value.trim());
      saveSettings({ [`p${idx}Start`]: e.target.value.trim() });
    }
  });

  // 自動取得ボタン
  document.getElementById(`btn-fetch-${idx}`).addEventListener('click', async () => {
    const panel = panels[idx];
    if (panel.platform !== 'youtube' || !panel.loadedId) {
      setStatus('先に YouTube 動画を読み込んでください', 'error'); return;
    }
    const apiKey = document.getElementById('yt-api-key').value.trim();
    if (!apiKey) {
      setStatus('⚙ 共通設定に YouTube API Key を入力してください', 'error'); return;
    }
    setStatus('配信開始時刻を取得中…');
    try {
      const result = await fetchYouTubeStartTime(panel.loadedId, apiKey);
      if (!result.time) {
        setStatus('配信開始時刻を取得できませんでした（ライブ配信・アーカイブ動画のみ対応）', 'error'); return;
      }
      const hms   = result.time;
      const label = result.type === 'scheduled' ? '配信予定時刻' : '配信開始時刻';
      document.getElementById(`start-${idx}`).value = hms;
      panels[idx].startTimeSecs = parseHMS(hms);
      syncManager.setStartTime(`p${idx}`, hms);
      saveSettings({ [`p${idx}Start`]: hms });
      setStatus(`${label}を取得: ${hms}（元データ UTC: ${result.raw}）`, 'ok');
    } catch (err) {
      setStatus(`取得エラー: ${err.message}`, 'error');
    }
  });

  // 微調整ボタン
  document.querySelectorAll(`.btn--ft[data-panel="${idx}"]`).forEach(btn => {
    btn.addEventListener('click', () => panels[idx].adjustStartTime(Number(btn.dataset.delta)));
  });

  // チャットボタン
  document.getElementById(`btn-chat-${idx}`).addEventListener('click', () => {
    const panel = panels[idx];
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
}

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
    setStatus(`P${panelIdx + 1} ${platformName} チャット受信中`, 'ok');
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
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return 'youtube';
  if (/^[A-Za-z0-9_]{1,25}$/.test(raw)) return 'twitch';
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
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function parseHMS(str) {
  if (!str?.trim()) return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
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

  const startTime  = ld.actualStartTime ?? ld.scheduledStartTime ?? null;
  if (!startTime) return { time: null, type: 'none' };

  const isScheduled = !ld.actualStartTime && !!ld.scheduledStartTime;
  const d = new Date(startTime);
  if (isNaN(d.getTime())) return { time: null, type: 'none' };

  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
  return { time: hms, type: isScheduled ? 'scheduled' : 'actual', raw: startTime };
}

// ===== 初期化 =====

async function init() {
  settings = await loadSettings();

  // GitHub Pages での relay URL 自動設定
  if (location.hostname.endsWith('github.io') && !settings.ytRelayUrl && !settings.twRelayUrl) {
    const parts    = location.pathname.split('/');
    const repoBase = location.origin + '/' + parts[1] + '/';
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
  setValue('yt-api-key',   settings.ytApiKey);
  setValue('yt-relay-url', settings.ytRelayUrl);
  setValue('tw-parent',    settings.twParent);
  setValue('tw-relay-url', settings.twRelayUrl);

  // 同期基準
  syncRefIdx = Math.min(settings.syncRefIdx ?? 0, (settings.panelCount ?? 2) - 1);

  // パネルを動的生成
  const count = Math.max(1, Math.min(4, settings.panelCount ?? 2));
  for (let i = 0; i < count; i++) {
    document.getElementById('stage').insertAdjacentHTML('beforeend', createPanelHTML(i));
    const p = new PanelController(i);
    panels.push(p);

    const platform = settings[`p${i}Platform`] || (i === 1 ? 'twitch' : 'youtube');
    p.setPlatform(platform);

    setValue(`url-${i}`,   settings[`p${i}Url`]);
    setValue(`start-${i}`, settings[`p${i}Start`]);

    const secs = parseHMS(settings[`p${i}Start`]);
    if (secs !== null) {
      p.startTimeSecs = secs;
      syncManager.setStartTime(`p${i}`, settings[`p${i}Start`]);
    }

    bindPanelEvents(i);
  }

  // レイアウト
  currentLayout = settings.layout ?? 'lp2-h';
  refreshLayoutSelector();
  refreshSyncRefSelector();
  applyLayout(bestLayoutForCount(panels.length));
}

// ===== ヘッダーのイベント =====

// ＋ パネル追加
document.getElementById('btn-panel-add').addEventListener('click', addPanel);

// － パネル削除
document.getElementById('btn-panel-remove').addEventListener('click', removePanel);

// レイアウト選択
document.getElementById('sel-layout').addEventListener('change', (e) => {
  applyLayout(e.target.value);
});

// 同期基準選択
document.getElementById('sel-sync-ref').addEventListener('change', (e) => {
  syncRefIdx = Number(e.target.value);
  saveSettings({ syncRefIdx });
});

// 同期ボタン
document.getElementById('btn-sync').addEventListener('click', () => {
  const refPanel = panels[syncRefIdx];
  if (!refPanel.player?.isReady()) {
    setStatus(`P${syncRefIdx + 1} が未準備です（動画を読み込んで再生してください）`, 'error'); return;
  }
  if (refPanel.startTimeSecs == null) {
    setStatus(`P${syncRefIdx + 1} の配信開始時刻が未設定です`, 'error'); return;
  }
  const refPos = refPanel.player.getCurrentTime();
  if (refPos === null) {
    setStatus('再生位置を取得できませんでした（しばらく再生してから再試行してください）', 'error'); return;
  }

  const realTimeSecs = refPanel.startTimeSecs + refPos;
  let synced = 0;
  const skipped = [];

  panels.forEach((p, i) => {
    if (i === syncRefIdx) return;
    if (!p.player?.isReady())      { skipped.push(`P${i+1}未準備`); return; }
    if (p.startTimeSecs == null)   { skipped.push(`P${i+1}時刻未設定`); return; }
    const targetPos = realTimeSecs - p.startTimeSecs;
    if (targetPos < 0)             { skipped.push(`P${i+1}時刻前`); return; }
    p.player.seekTo(targetPos);
    synced++;
  });

  const suffix = skipped.length ? `（スキップ: ${skipped.join(', ')}）` : '';
  if (synced > 0) {
    setStatus(`P${syncRefIdx + 1} 基準で ${synced} パネルを同期しました${suffix}`, 'ok');
  } else {
    setStatus(`同期できるパネルがありませんでした ${suffix}`, 'error');
  }
});

// ⚙ 共通設定トグル
document.getElementById('btn-settings').addEventListener('click', () => {
  const el  = document.getElementById('global-settings');
  const btn = document.getElementById('btn-settings');
  el.hidden = !el.hidden;
  btn.classList.toggle('is-open', !el.hidden);
});

// 共通設定の変更を保存
document.getElementById('yt-api-key').addEventListener('change', (e) => {
  settings.ytApiKey = e.target.value.trim();
  saveSettings({ ytApiKey: settings.ytApiKey });
  panels.forEach(p => p._ytChat?.updateApiKey(settings.ytApiKey));
});

document.getElementById('yt-relay-url').addEventListener('change', (e) => {
  settings.ytRelayUrl = e.target.value.trim();
  saveSettings({ ytRelayUrl: settings.ytRelayUrl });
  panels.forEach(p => p._ytPlayer?.setRelayUrl(settings.ytRelayUrl));
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

init().catch(console.error);

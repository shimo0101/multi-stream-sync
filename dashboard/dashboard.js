import { YouTubePlayer }              from '../scripts/youtube-player.js';
import { TwitchPlayer }               from '../scripts/twitch-player.js';
import { CommentOverlay }             from '../scripts/comment-overlay.js';
import { SyncManager }                from '../scripts/sync-manager.js';
import { YouTubeChatClient }          from '../scripts/youtube-chat.js';
import { TwitchChatClient }           from '../scripts/twitch-chat.js';
import { loadSettings, saveSettings } from '../scripts/storage.js';

// ===== グローバル状態 =====

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
           || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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

// ===== パネル表示順 =====

let visualOrder  = [];   // visualOrder[i] = CSS order value for panel i
let dragPanelIdx = null; // ドラッグ中のパネルインデックス

function applyVisualOrder() {
  for (let i = 0; i < panels.length; i++) {
    const el = document.getElementById(`panel-${i}`);
    if (el) el.style.order = visualOrder[i] ?? i;
  }
}

function swapPanelVisualOrder(idxA, idxB) {
  [visualOrder[idxA], visualOrder[idxB]] = [visualOrder[idxB], visualOrder[idxA]];
  applyVisualOrder();
  refreshSyncRefSelector(); // 視覚位置が変わったので P1/P2 ラベルを更新
  saveSettings({ visualOrder: visualOrder.slice() });
}

// ===== パネル HTML テンプレート =====

function createPanelHTML(idx) {
  return `
    <section class="panel" id="panel-${idx}" aria-label="プレイヤー ${idx + 1}">
      <div class="panel-config" id="panel-config-${idx}">
        <div class="config-row">
          <button class="btn--drag-handle" title="ドラッグして並び替え">⠿</button>
          <div class="platform-switch" data-panel="${idx}">
            <button class="plat-btn plat-btn--yt active" data-platform="youtube">YouTube</button>
            <button class="plat-btn plat-btn--tw"        data-platform="twitch">Twitch</button>
          </div>
          <input type="text" id="url-${idx}" class="input input--url"
                 placeholder="URL を入力（自動判別）" autocomplete="off">
          <button id="btn-load-${idx}" class="btn btn--load">読込</button>
          <button id="btn-collapse-${idx}" class="btn--collapse" title="ツールバーを折りたたむ">▲</button>
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
        <button id="btn-mute-${idx}" class="btn--mute" title="ミュート">🔊</button>
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
    this.isMuted   = isIOS;
  }

  setMuted(muted) {
    if (!muted) {
      panels.forEach((p, i) => { if (i !== this.idx) p.setMuted(true); });
    }
    this.isMuted = muted;
    const btn = document.getElementById(`btn-mute-${this.idx}`);
    if (btn) {
      btn.textContent = muted ? '🔇' : '🔊';
      btn.classList.toggle('is-muted', muted);
      btn.title = muted ? 'ミュート解除' : 'ミュート';
    }
    this.player?.setMuted(muted);
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
          onMessage:      ({ text, isOwner, isModerator, isMember, avatarUrl }) => {
            const color = isOwner     ? 'rgba(250,204,21,0.92)'
                        : isModerator ? 'rgba(96,165,250,0.92)'
                        : isMember    ? 'rgba(110,231,183,0.92)'
                        : 'rgba(255,255,255,0.82)';
            this.overlay.addComment(text, { color, avatarUrl: avatarUrl ?? null });
          },
          onError:        (msg) => setStatus(`P${this.idx + 1} YouTube チャットエラー: ${msg}`, 'error'),
          onStatusChange: (s)   => updateChatBtn(this.idx, s, 'YouTube'),
        });
      }
      return this._ytChat;
    } else {
      if (!this._twChat) {
        this._twChat = new TwitchChatClient({
          onMessage:      ({ text, isOwner, isModerator, isMember }) => {
            const color = isOwner     ? 'rgba(250,204,21,0.92)'
                        : isModerator ? 'rgba(96,165,250,0.92)'
                        : isMember    ? 'rgba(110,231,183,0.92)'
                        : 'rgba(255,255,255,0.82)';
            this.overlay.addComment(text, { color });
          },
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
      player.load(videoId, { muted: this.isMuted });
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
      player.load(parsed.id, parsed.type, { muted: this.isMuted });
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

  // 新パネルを視覚的に末尾に配置
  const maxOrd = visualOrder.length > 0 ? Math.max(...visualOrder) : -1;
  visualOrder.push(maxOrd + 1);
  applyVisualOrder();

  refreshLayoutSelector();
  refreshSyncRefSelector();
  applyLayout(bestLayoutForCount(panels.length));
  saveSettings({ panelCount: panels.length, visualOrder: visualOrder.slice() });
}

function removePanel() {
  if (panels.length <= 1) { setStatus('パネルは最低1つ必要です', 'error'); return; }
  const idx = panels.length - 1;
  panels.pop().destroy();
  document.getElementById(`panel-${idx}`)?.remove();

  visualOrder.splice(idx, 1);
  applyVisualOrder();

  if (syncRefIdx >= panels.length) {
    syncRefIdx = panels.length - 1;
    saveSettings({ syncRefIdx });
  }

  refreshLayoutSelector();
  refreshSyncRefSelector();
  applyLayout(bestLayoutForCount(panels.length));
  saveSettings({ panelCount: panels.length, visualOrder: visualOrder.slice() });
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
  // 視覚位置順（小 → 大）に並べた内部インデックス列
  const byVisual = [...panels.keys()].sort((a, b) => (visualOrder[a] ?? a) - (visualOrder[b] ?? b));
  // 選択肢を視覚位置順で表示し、value には内部インデックスを保持
  sel.innerHTML = byVisual.map((internalIdx, visualPos) =>
    `<option value="${internalIdx}"${internalIdx === syncRefIdx ? ' selected' : ''}>P${visualPos + 1} 基準</option>`
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

  // ミュートボタン
  document.getElementById(`btn-mute-${idx}`).addEventListener('click', () => {
    panels[idx].setMuted(!panels[idx].isMuted);
  });

  // 折りたたみボタン
  document.getElementById(`btn-collapse-${idx}`).addEventListener('click', () => {
    const config    = document.getElementById(`panel-config-${idx}`);
    const btn       = document.getElementById(`btn-collapse-${idx}`);
    const collapsed = config.classList.toggle('is-collapsed');
    btn.textContent = collapsed ? '▼' : '▲';
    btn.title = collapsed ? 'ツールバーを展開' : 'ツールバーを折りたたむ';
  });

  // iOS: 初期ミュート状態をボタン UI に反映
  if (isIOS) panels[idx].setMuted(true);

  // モバイル（幅 640px 以下）ではデフォルトでツールバーを折りたたむ
  if (window.matchMedia('(max-width: 640px)').matches) {
    document.getElementById(`panel-config-${idx}`).classList.add('is-collapsed');
    document.getElementById(`btn-collapse-${idx}`).textContent = '▼';
    document.getElementById(`btn-collapse-${idx}`).title = 'ツールバーを展開';
  }

  // ドラッグ並び替え
  setupPanelDrag(idx);

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

// ===== ドラッグ並び替え =====

function setupPanelDrag(idx) {
  const panelEl = document.getElementById(`panel-${idx}`);
  const handle  = panelEl.querySelector('.btn--drag-handle');

  // ハンドルを押したときだけパネルをドラッグ可能にする
  handle.addEventListener('mousedown', () => {
    panelEl.setAttribute('draggable', 'true');
  });

  panelEl.addEventListener('dragstart', (e) => {
    dragPanelIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx)); // Firefox 対応
    // setTimeoutで描画後にクラス適用（Ghost imageが透明にならないよう）
    setTimeout(() => panelEl.classList.add('is-dragging'), 0);
  });

  panelEl.addEventListener('dragend', () => {
    dragPanelIdx = null;
    panelEl.setAttribute('draggable', 'false');
    panelEl.classList.remove('is-dragging');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-drag-over'));
  });

  panelEl.addEventListener('dragover', (e) => {
    if (dragPanelIdx === null || dragPanelIdx === idx) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!panelEl.classList.contains('is-drag-over')) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-drag-over'));
      panelEl.classList.add('is-drag-over');
    }
  });

  panelEl.addEventListener('dragleave', (e) => {
    if (!panelEl.contains(e.relatedTarget)) {
      panelEl.classList.remove('is-drag-over');
    }
  });

  panelEl.addEventListener('drop', (e) => {
    e.preventDefault();
    panelEl.classList.remove('is-drag-over');
    if (dragPanelIdx !== null && dragPanelIdx !== idx) {
      swapPanelVisualOrder(dragPanelIdx, idx);
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
  setValue('tw-client-id', settings.twClientId);

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

  // パネル表示順を復元
  const savedOrder = settings.visualOrder;
  if (Array.isArray(savedOrder) && savedOrder.length === panels.length) {
    visualOrder = savedOrder.slice();
  } else {
    visualOrder = Array.from({ length: panels.length }, (_, i) => i);
  }
  applyVisualOrder();

  // レイアウト
  currentLayout = settings.layout ?? 'lp2-h';
  refreshLayoutSelector();
  refreshSyncRefSelector();
  applyLayout(bestLayoutForCount(panels.length));

  // URL パラメーター経由のインポート（Android でリンクを開いたとき）
  // ※ パネル生成後に実行することで cbOpen() 内の P1〜P4 ボタンが正しく描画される
  const _importParam = new URLSearchParams(location.search).get('import-ch');
  if (_importParam) {
    const added = cbImport(_importParam);
    if (added > 0) {
      cbSetStatus(`${added} チャンネルを取り込みました`, 'ok');
      cbOpen();
    } else if (added === 0) {
      cbSetStatus('すべてのチャンネルは既に登録済みです', 'info');
    } else {
      cbSetStatus('チャンネルデータの読み込みに失敗しました', 'error');
    }
    history.replaceState(null, '', location.pathname);
  }
}

// ===== ヘッダーのイベント =====

// ＋ パネル追加
document.getElementById('btn-panel-add').addEventListener('click', addPanel);

// ↺ 並び順リセット
document.getElementById('btn-order-reset').addEventListener('click', () => {
  visualOrder = Array.from({ length: panels.length }, (_, i) => i);
  applyVisualOrder();
  refreshSyncRefSelector();
  saveSettings({ visualOrder: visualOrder.slice() });
  setStatus('パネルの並び順をリセットしました', 'ok');
});

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

// 全読込ボタン
document.getElementById('btn-load-all').addEventListener('click', () => {
  let loaded = 0;
  panels.forEach((p, i) => {
    const raw = document.getElementById(`url-${i}`).value.trim();
    if (!raw) return;
    p.load(raw);
    saveSettings({ [`p${i}Url`]: raw });
    loaded++;
  });
  if (loaded === 0) setStatus('読み込む URL がありません', 'error');
  else setStatus(`${loaded} パネルを読み込み中…`);
});

// 全チャット開始ボタン
document.getElementById('btn-chat-all').addEventListener('click', () => {
  let started = 0;
  panels.forEach((p, i) => {
    const chat = p.getOrCreateChat();
    if (p.platform === 'youtube') {
      if (chat.isRunning() || !p.loadedId) return;
      chat.updateApiKey(document.getElementById('yt-api-key').value.trim());
      chat.start(p.loadedId);
      started++;
    } else {
      if (chat.isConnected() || !p.loadedId) return;
      chat.connect(p.loadedId);
      started++;
    }
  });
  if (started === 0) setStatus('チャットを開始できるパネルがありません（動画を先に読み込んでください）', 'error');
  else setStatus(`${started} パネルのチャットを開始しました`, 'ok');
});

// ⛶ 全画面トグル（アプリ UI）
function setFullscreen(on) {
  document.body.classList.toggle('is-fullscreen', on);
  if (on) cbClose();
}

document.getElementById('btn-fullscreen').addEventListener('click', () => {
  setFullscreen(!document.body.classList.contains('is-fullscreen'));
});

document.getElementById('btn-exit-fullscreen').addEventListener('click', () => {
  setFullscreen(false);
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'f' || e.key === 'F') setFullscreen(!document.body.classList.contains('is-fullscreen'));
  if (e.key === 'Escape') setFullscreen(false);
});

// ⛶ ブラウザ全画面（アドレスバー非表示）
const btnNativeFs = document.getElementById('btn-native-fs');

if (!document.fullscreenEnabled) {
  // iOS Safari は requestFullscreen 非対応のため非表示
  btnNativeFs.hidden = true;
} else {
  btnNativeFs.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  document.addEventListener('fullscreenchange', () => {
    btnNativeFs.classList.toggle('is-open', !!document.fullscreenElement);
  });
}

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

document.getElementById('tw-client-id').addEventListener('change', (e) => {
  settings.twClientId = e.target.value.trim();
  saveSettings({ twClientId: settings.twClientId });
});

init().catch(console.error);

// ===== チャンネルブラウザ =====

const CB_STORAGE_KEY = 'multi-stream-sync-favorites';

// お気に入りデータ（ライブ状態はメモリのみ、永続化しない）
let cbFavorites    = { youtube: [], twitch: [] };
let cbYtLiveSorted = false;
let cbTwLiveSorted = false;

function cbLoad() {
  try {
    const stored = JSON.parse(localStorage.getItem(CB_STORAGE_KEY) || '{}');
    cbFavorites = {
      youtube: (stored.youtube ?? []).map(ch => ({ ...ch, liveVideoId: null, liveTitle: null })),
      twitch:  (stored.twitch  ?? []).map(ch => ({ ...ch, isLive: false, liveTitle: null })),
    };
  } catch {
    cbFavorites = { youtube: [], twitch: [] };
  }
}

function cbSave() {
  try {
    const data = {
      youtube: cbFavorites.youtube.map(({ channelId, name, thumbnailUrl }) => ({ channelId, name, thumbnailUrl })),
      twitch:  cbFavorites.twitch.map(({ username, thumbnailUrl }) => ({ username, thumbnailUrl })),
    };
    localStorage.setItem(CB_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// YouTube: @ハンドル or チャンネルID → チャンネル情報を取得
async function cbResolveYouTubeChannel(input) {
  const apiKey = settings.ytApiKey;
  if (!apiKey) throw new Error('YouTube API Key が未設定です（⚙ 共通設定で入力してください）');

  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('key', apiKey);

  const clean = input.trim();
  if (clean.startsWith('@')) {
    url.searchParams.set('forHandle', clean.slice(1));
  } else if (/^UC[\w-]{22}$/.test(clean)) {
    url.searchParams.set('id', clean);
  } else {
    url.searchParams.set('forHandle', clean);
  }

  const res = await fetch(url);
  if (res.status === 403) throw new Error('API キーが無効です');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('チャンネルが見つかりません');

  return {
    channelId:    item.id,
    name:         item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
    liveVideoId:  null,
    liveTitle:    null,
  };
}

// YouTube: ライブ配信中の動画を取得
async function cbFetchYouTubeLive(channelId) {
  const apiKey = settings.ytApiKey;
  if (!apiKey) return null;

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('channelId', channelId);
  url.searchParams.set('type', 'video');
  url.searchParams.set('eventType', 'live');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;
    return { videoId: item.id.videoId, title: item.snippet.title };
  } catch {
    return null;
  }
}

// パネル選択ボタンを生成（現在存在するパネル数に応じて）
function cbPanelButtons(openAttr, enabled) {
  return panels.map((_, pi) =>
    `<button class="cb-open-btn" ${openAttr}="${pi}" ${enabled ? '' : 'disabled'}>P${pi + 1}</button>`
  ).join('');
}

function cbRenderYtList() {
  const list = document.getElementById('cb-yt-list');
  if (!cbFavorites.youtube.length) {
    list.innerHTML = '<li class="cb-empty">チャンネルを追加してください</li>';
    return;
  }
  const view = cbFavorites.youtube.map((ch, i) => ({ ...ch, origIdx: i }));
  if (cbYtLiveSorted) view.sort((a, b) => (b.liveVideoId ? 1 : 0) - (a.liveVideoId ? 1 : 0));
  const last    = view.length - 1;
  const sortBar = cbYtLiveSorted
    ? `<li><div class="cb-sort-bar">ライブ順で表示中 <button class="btn-sort-reset" data-reset-yt-sort>↺ 元の順序</button></div></li>`
    : '';
  list.innerHTML = sortBar + view.map((ch, vi) => `
    <li class="cb-item${ch.liveVideoId ? ' is-live' : ''}">
      ${ch.thumbnailUrl
        ? `<img class="cb-avatar" src="${escHtml(ch.thumbnailUrl)}" alt="">`
        : `<div class="cb-avatar-initial" style="background:#cc0000">${escHtml(ch.name[0] ?? '?')}</div>`
      }
      <div class="cb-info">
        <div class="cb-name">${escHtml(ch.name)}</div>
        <div class="cb-status">
          ${ch.liveVideoId
            ? `<span class="cb-live-badge">LIVE</span>${escHtml(ch.liveTitle ?? '')}`
            : '配信なし'}
        </div>
      </div>
      <div class="cb-actions">
        <div class="cb-panel-row">
          ${panels.map((_, pi) =>
            `<button class="cb-open-btn" data-cb-yt-open="${ch.origIdx}" data-panel="${pi}"
                     ${ch.liveVideoId ? '' : 'disabled'}>P${pi + 1}</button>`
          ).join('')}
        </div>
        ${!cbYtLiveSorted ? `
        <div class="cb-reorder-row">
          <button class="cb-reorder-btn" data-cb-yt-up="${ch.origIdx}" ${vi === 0    ? 'disabled' : ''}>↑</button>
          <button class="cb-reorder-btn" data-cb-yt-down="${ch.origIdx}" ${vi === last ? 'disabled' : ''}>↓</button>
        </div>` : ''}
        <button class="cb-del-btn" data-cb-yt-del="${ch.origIdx}">✕</button>
      </div>
    </li>
  `).join('');
}

function cbRenderTwList() {
  const list = document.getElementById('cb-tw-list');
  if (!cbFavorites.twitch.length) {
    list.innerHTML = '<li class="cb-empty">チャンネルを追加してください</li>';
    return;
  }
  const view = cbFavorites.twitch.map((ch, i) => ({ ...ch, origIdx: i }));
  if (cbTwLiveSorted) view.sort((a, b) => (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0));
  const last    = view.length - 1;
  const sortBar = cbTwLiveSorted
    ? `<li><div class="cb-sort-bar">ライブ順で表示中 <button class="btn-sort-reset" data-reset-tw-sort>↺ 元の順序</button></div></li>`
    : '';
  list.innerHTML = sortBar + view.map((ch, vi) => `
    <li class="cb-item${ch.isLive ? ' is-live' : ''}">
      ${ch.thumbnailUrl
        ? `<img class="cb-avatar" src="${escHtml(ch.thumbnailUrl)}" alt="">`
        : `<div class="cb-avatar-initial" style="background:#6441a5">${escHtml(ch.username[0].toUpperCase())}</div>`
      }
      <div class="cb-info">
        <div class="cb-name">${escHtml(ch.username)}</div>
        <div class="cb-status">
          ${ch.isLive
            ? `<span class="cb-live-badge">LIVE</span>${escHtml(ch.liveTitle ?? '')}`
            : 'Twitch'}
        </div>
      </div>
      <div class="cb-actions">
        <div class="cb-panel-row">
          ${panels.map((_, pi) =>
            `<button class="cb-open-btn" data-cb-tw-open="${ch.origIdx}" data-panel="${pi}">P${pi + 1}</button>`
          ).join('')}
        </div>
        ${!cbTwLiveSorted ? `
        <div class="cb-reorder-row">
          <button class="cb-reorder-btn" data-cb-tw-up="${ch.origIdx}" ${vi === 0    ? 'disabled' : ''}>↑</button>
          <button class="cb-reorder-btn" data-cb-tw-down="${ch.origIdx}" ${vi === last ? 'disabled' : ''}>↓</button>
        </div>` : ''}
        <button class="cb-del-btn" data-cb-tw-del="${ch.origIdx}">✕</button>
      </div>
    </li>
  `).join('');
}

function cbOpen() {
  cbRenderYtList();
  cbRenderTwList();
  document.getElementById('channel-browser').classList.add('is-open');
  document.getElementById('btn-browser').classList.add('is-open');
}

function cbClose() {
  document.getElementById('channel-browser').classList.remove('is-open');
  document.getElementById('btn-browser').classList.remove('is-open');
}

// ブラウザ開閉
document.getElementById('btn-browser').addEventListener('click', () => {
  document.getElementById('channel-browser').classList.contains('is-open') ? cbClose() : cbOpen();
});
document.getElementById('btn-cb-close').addEventListener('click', cbClose);

// タブ切り替え
document.querySelectorAll('.cb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.cb-tab').forEach(t => t.classList.remove('cb-tab--active'));
    document.querySelectorAll('.cb-pane').forEach(p => p.classList.add('cb-pane--hidden'));
    tab.classList.add('cb-tab--active');
    document.getElementById(`cb-pane-${tab.dataset.cbTab}`).classList.remove('cb-pane--hidden');
  });
});

// YouTube: 追加（Enter / ボタン）
async function cbYtAdd() {
  const input = document.getElementById('cb-yt-input').value.trim();
  if (!input) return;

  const btn = document.getElementById('cb-yt-add');
  btn.disabled = true;
  btn.textContent = '検索中…';

  try {
    const ch = await cbResolveYouTubeChannel(input);
    if (!cbFavorites.youtube.some(c => c.channelId === ch.channelId)) {
      cbFavorites.youtube.push(ch);
      cbSave();
    }
    document.getElementById('cb-yt-input').value = '';
    cbRenderYtList();
    cbSetStatus(`YouTube "${ch.name}" を追加しました`, 'ok');
  } catch (err) {
    cbSetStatus(`追加エラー: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '追加';
  }
}

document.getElementById('cb-yt-add').addEventListener('click', cbYtAdd);
document.getElementById('cb-yt-input').addEventListener('keydown', e => { if (e.key === 'Enter') cbYtAdd(); });

// YouTube: ライブ確認
document.getElementById('cb-yt-refresh').addEventListener('click', async () => {
  if (!cbFavorites.youtube.length) { cbSetStatus('チャンネルを追加してください', 'error'); return; }
  if (!settings.ytApiKey) { cbSetStatus('YouTube API Key が未設定です（⚙ 共通設定）', 'error'); return; }

  const btn = document.getElementById('cb-yt-refresh');
  btn.disabled = true;
  btn.textContent = '確認中…';

  await Promise.all(cbFavorites.youtube.map(async (ch, i) => {
    const live = await cbFetchYouTubeLive(ch.channelId);
    cbFavorites.youtube[i].liveVideoId = live?.videoId ?? null;
    cbFavorites.youtube[i].liveTitle   = live?.title   ?? null;
  }));

  cbYtLiveSorted = true;
  cbRenderYtList();
  btn.disabled = false;
  btn.textContent = 'ライブ確認';

  const liveCount = cbFavorites.youtube.filter(c => c.liveVideoId).length;
  cbSetStatus(`ライブ確認完了 — ${liveCount} チャンネルが配信中`, liveCount > 0 ? 'ok' : 'info');
});

// Twitch: 登録時にプロフィール画像を取得（token・clientId がなければ null）
async function cbFetchTwitchThumbnail(username) {
  const token    = localStorage.getItem('mss-tw-token');
  const clientId = settings.twClientId;
  if (!token || !clientId) return null;
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': clientId } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.profile_image_url ?? null;
  } catch { return null; }
}

// Twitch: 追加
async function cbTwAdd() {
  const username = document.getElementById('cb-tw-input').value.trim().toLowerCase();
  if (!username) return;
  if (!/^[a-z0-9_]{1,25}$/.test(username)) { cbSetStatus('無効なチャンネル名です', 'error'); return; }

  if (!cbFavorites.twitch.some(c => c.username === username)) {
    const thumbnailUrl = await cbFetchTwitchThumbnail(username);
    cbFavorites.twitch.push({ username, thumbnailUrl });
    cbSave();
  }
  document.getElementById('cb-tw-input').value = '';
  cbRenderTwList();
  cbSetStatus(`Twitch "${username}" を追加しました`, 'ok');
}

document.getElementById('cb-tw-add').addEventListener('click', cbTwAdd);
document.getElementById('cb-tw-input').addEventListener('keydown', e => { if (e.key === 'Enter') cbTwAdd(); });

// Twitch: ライブ確認
async function cbFetchTwitchLiveStreams() {
  const token    = localStorage.getItem('mss-tw-token');
  const clientId = settings.twClientId;
  if (!token || !clientId) return null;
  const query = cbFavorites.twitch
    .map(ch => `user_login=${encodeURIComponent(ch.username)}`).join('&');
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?${query}&first=100`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': clientId } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? [];
  } catch { return null; }
}

document.getElementById('cb-tw-live').addEventListener('click', async () => {
  if (!cbFavorites.twitch.length) { cbSetStatus('チャンネルを追加してください', 'error'); return; }
  if (!settings.twClientId || !localStorage.getItem('mss-tw-token')) {
    cbSetStatus('Twitch Client ID と認証が必要です（動画ピッカーから認証してください）', 'error');
    return;
  }
  const btn = document.getElementById('cb-tw-live');
  btn.disabled = true;
  btn.textContent = '確認中…';

  const streams = await cbFetchTwitchLiveStreams();
  if (streams === null) {
    cbSetStatus('ライブ確認に失敗しました', 'error');
  } else {
    cbFavorites.twitch.forEach((_, i) => {
      cbFavorites.twitch[i].isLive    = false;
      cbFavorites.twitch[i].liveTitle = null;
    });
    for (const s of streams) {
      const idx = cbFavorites.twitch.findIndex(
        ch => ch.username.toLowerCase() === s.user_login.toLowerCase()
      );
      if (idx !== -1) {
        cbFavorites.twitch[idx].isLive    = true;
        cbFavorites.twitch[idx].liveTitle = s.title;
      }
    }
    cbTwLiveSorted = true;
    cbRenderTwList();
    cbSetStatus(
      `ライブ確認完了 — ${streams.length} チャンネルが配信中`,
      streams.length > 0 ? 'ok' : 'info'
    );
  }
  btn.disabled = false;
  btn.textContent = 'ライブ確認';
});

// Twitch: アイコン一括更新
document.getElementById('cb-tw-refresh').addEventListener('click', async () => {
  if (!cbFavorites.twitch.length) { cbSetStatus('チャンネルを追加してください', 'error'); return; }
  if (!settings.twClientId || !localStorage.getItem('mss-tw-token')) {
    cbSetStatus('Twitch Client ID と認証が必要です（動画ピッカーから認証してください）', 'error');
    return;
  }

  const btn = document.getElementById('cb-tw-refresh');
  btn.disabled    = true;
  btn.textContent = '更新中…';

  await Promise.all(cbFavorites.twitch.map(async (ch, i) => {
    const url = await cbFetchTwitchThumbnail(ch.username);
    if (url) cbFavorites.twitch[i].thumbnailUrl = url;
  }));

  cbSave();
  cbRenderTwList();
  btn.disabled    = false;
  btn.textContent = 'アイコン更新';
  cbSetStatus('Twitch アイコンを更新しました', 'ok');
});

// YouTube リスト: 並び替え・削除・パネル展開（イベント委任）
document.getElementById('cb-yt-list').addEventListener('click', (e) => {
  if (e.target.closest('[data-reset-yt-sort]')) {
    cbYtLiveSorted = false; cbRenderYtList(); return;
  }

  const upIdx = e.target.dataset.cbYtUp;
  if (upIdx != null) {
    const i = Number(upIdx);
    [cbFavorites.youtube[i - 1], cbFavorites.youtube[i]] = [cbFavorites.youtube[i], cbFavorites.youtube[i - 1]];
    cbSave(); cbRenderYtList(); return;
  }

  const downIdx = e.target.dataset.cbYtDown;
  if (downIdx != null) {
    const i = Number(downIdx);
    [cbFavorites.youtube[i], cbFavorites.youtube[i + 1]] = [cbFavorites.youtube[i + 1], cbFavorites.youtube[i]];
    cbSave(); cbRenderYtList(); return;
  }

  const delIdx = e.target.dataset.cbYtDel;
  if (delIdx != null) {
    cbYtLiveSorted = false;
    cbFavorites.youtube.splice(Number(delIdx), 1);
    cbSave();
    cbRenderYtList();
    return;
  }

  const openIdx  = e.target.dataset.cbYtOpen;
  const panelIdx = e.target.dataset.panel;
  if (openIdx != null && panelIdx != null) {
    const ch = cbFavorites.youtube[Number(openIdx)];
    if (!ch?.liveVideoId) return;
    const pi = Number(panelIdx);
    panels[pi].setPlatform('youtube');
    document.getElementById(`url-${pi}`).value = ch.liveVideoId;
    panels[pi].load(ch.liveVideoId);
    saveSettings({ [`p${pi}Platform`]: 'youtube', [`p${pi}Url`]: ch.liveVideoId });
    cbClose();
  }
});

// Twitch リスト: 並び替え・削除・パネル展開（イベント委任）
document.getElementById('cb-tw-list').addEventListener('click', (e) => {
  if (e.target.closest('[data-reset-tw-sort]')) {
    cbTwLiveSorted = false; cbRenderTwList(); return;
  }

  const upIdx = e.target.dataset.cbTwUp;
  if (upIdx != null) {
    const i = Number(upIdx);
    [cbFavorites.twitch[i - 1], cbFavorites.twitch[i]] = [cbFavorites.twitch[i], cbFavorites.twitch[i - 1]];
    cbSave(); cbRenderTwList(); return;
  }

  const downIdx = e.target.dataset.cbTwDown;
  if (downIdx != null) {
    const i = Number(downIdx);
    [cbFavorites.twitch[i], cbFavorites.twitch[i + 1]] = [cbFavorites.twitch[i + 1], cbFavorites.twitch[i]];
    cbSave(); cbRenderTwList(); return;
  }

  const delIdx = e.target.dataset.cbTwDel;
  if (delIdx != null) {
    cbTwLiveSorted = false;
    cbFavorites.twitch.splice(Number(delIdx), 1);
    cbSave();
    cbRenderTwList();
    return;
  }

  const openIdx  = e.target.dataset.cbTwOpen;
  const panelIdx = e.target.dataset.panel;
  if (openIdx != null && panelIdx != null) {
    const ch = cbFavorites.twitch[Number(openIdx)];
    if (!ch?.username) return;
    const pi = Number(panelIdx);
    panels[pi].setPlatform('twitch');
    document.getElementById(`url-${pi}`).value = ch.username;
    panels[pi].load(ch.username);
    saveSettings({ [`p${pi}Platform`]: 'twitch', [`p${pi}Url`]: ch.username });
    cbClose();
  }
});

// ===== チャンネルブラウザ内ステータス（モバイルで底部ステータスバーが隠れる対策） =====

let cbStatusTimer = null;
function cbSetStatus(msg, type = 'info') {
  setStatus(msg, type); // 底部ステータスバーも更新（デスクトップ用）
  const el = document.getElementById('cb-status-bar');
  if (!el) return;
  el.textContent    = msg;
  el.dataset.type   = type;
  el.hidden         = false;
  clearTimeout(cbStatusTimer);
  cbStatusTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// YouTube: 動画ピッカーを新タブで開く
document.getElementById('cb-yt-picker').addEventListener('click', () => {
  const pickerUrl = new URL('../picker/index.html', location.href).href;
  window.open(pickerUrl, 'mss-picker');
});

// Twitch: チャンネルピッカーを新タブで開く
document.getElementById('cb-tw-picker').addEventListener('click', () => {
  const pickerUrl = new URL('../picker/index.html?tab=twitch', location.href).href;
  window.open(pickerUrl, 'mss-picker');
});

// picker ページからの BroadcastChannel メッセージを受信
try {
  const pickerBC = new BroadcastChannel('mss-picker');
  pickerBC.addEventListener('message', (e) => {
    const { type, platform, videoId, panelIdx } = e.data || {};
    if (type !== 'mss-open-video' || !videoId) return;
    const pi = Number(panelIdx);
    if (!Number.isFinite(pi) || pi < 0 || pi >= panels.length) return;
    const plat = platform === 'youtube' ? 'youtube' : 'twitch';
    panels[pi].setPlatform(plat);
    document.getElementById(`url-${pi}`).value = videoId;
    panels[pi].load(videoId);
    saveSettings({ [`p${pi}Platform`]: plat, [`p${pi}Url`]: videoId });
    setStatus(`P${pi + 1} に動画を読み込みました（ピッカーから）`, 'ok');
  });
} catch {}

// 起動時にお気に入りをロード
cbLoad();

// ===== チャンネル共有（PC → Android） =====

function cbExport() {
  const data = {
    yt: cbFavorites.youtube.map(ch => ({ i: ch.channelId, n: ch.name })),
    tw: cbFavorites.twitch.map(ch => ({ u: ch.username })),
  };
  const json = JSON.stringify(data);
  // URL-safe base64: +→- /→_ =省略。% エンコード不要になりアプリ経由でも壊れない
  const b64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
    (_, p) => String.fromCharCode(parseInt(p, 16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return location.origin + location.pathname + '?import-ch=' + b64;
}

function cbImport(b64raw) {
  try {
    // URL-safe(-/_)・標準(+/)どちらにも対応し、パディングを正規化してから atob
    const unpadded = b64raw.replace(/-/g, '+').replace(/_/g, '/').replace(/=/g, '');
    const b64 = unpadded + '='.repeat((4 - unpadded.length % 4) % 4);
    const json = decodeURIComponent(
      Array.from(atob(b64), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    );
    const data = JSON.parse(json);
    let added = 0;
    for (const ch of (data.yt || [])) {
      if (ch.i && !cbFavorites.youtube.some(c => c.channelId === ch.i)) {
        cbFavorites.youtube.push({ channelId: ch.i, name: ch.n || ch.i, thumbnailUrl: null, liveVideoId: null, liveTitle: null });
        added++;
      }
    }
    for (const ch of (data.tw || [])) {
      if (ch.u && !cbFavorites.twitch.some(c => c.username === ch.u)) {
        cbFavorites.twitch.push({ username: ch.u });
        added++;
      }
    }
    if (added > 0) cbSave();
    return added;
  } catch { return -1; }
}

// 📤 共有ボタン
document.getElementById('btn-cb-share').addEventListener('click', () => {
  const panel = document.getElementById('cb-share-panel');
  const isHidden = panel.hidden;
  panel.hidden = !isHidden;
  if (!isHidden) return;
  const url = cbExport();
  document.getElementById('cb-share-url-text').textContent = url;
});

// コピーボタン
document.getElementById('btn-cb-copy').addEventListener('click', async () => {
  const url = document.getElementById('cb-share-url-text').textContent;
  try {
    await navigator.clipboard.writeText(url);
    cbSetStatus('URL をコピーしました', 'ok');
  } catch {
    cbSetStatus('コピーできませんでした（手動でコピーしてください）', 'error');
  }
});


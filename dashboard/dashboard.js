import { YouTubePlayer }              from '../scripts/youtube-player.js';
import { TwitchPlayer }               from '../scripts/twitch-player.js';
import { CommentOverlay }             from '../scripts/comment-overlay.js';
import { SyncManager }                from '../scripts/sync-manager.js';
import { YouTubeChatClient }          from '../scripts/youtube-chat.js';
import { TwitchChatClient }           from '../scripts/twitch-chat.js';
import { loadSettings, saveSettings } from '../scripts/storage.js';

// ===== プレイヤー & オーバーレイ =====

const syncManager = new SyncManager();

let currentYtVideoId = null;
let currentTwChannel = null;

const ytPlayer = new YouTubePlayer('yt-player', {
  onReady: () => {
    setStatus('YouTube 準備完了', 'ok');
    document.getElementById('btn-yt-chat').disabled = false;
  },
});

// TwitchPlayer は init() で parent/relayUrl が設定されるまで sdk モード + localhost で待機
const twPlayer = new TwitchPlayer('tw-player', {
  onReady: () => {
    setStatus('Twitch 準備完了', 'ok');
    if (currentTwChannel) document.getElementById('btn-tw-chat').disabled = false;
  },
  parent:   'localhost',
  relayUrl: '',
});

syncManager.registerPlayer('yt', ytPlayer);
syncManager.registerPlayer('tw', twPlayer);

const ytOverlay = new CommentOverlay(document.getElementById('yt-canvas'));
const twOverlay = new CommentOverlay(document.getElementById('tw-canvas'));

// ===== チャットクライアント =====

const ytChat = new YouTubeChatClient({
  apiKey: '',
  onMessage:      ({ text, author }) => ytOverlay.addComment(author ? `${author}: ${text}` : text),
  onError:        (msg)    => setStatus(`YouTube チャットエラー: ${msg}`, 'error'),
  onStatusChange: (status) => updateChatBtn('yt', status),
});

const twChat = new TwitchChatClient({
  onMessage:      ({ text, author }) => twOverlay.addComment(author ? `${author}: ${text}` : text),
  onError:        (msg)    => setStatus(`Twitch チャットエラー: ${msg}`, 'error'),
  onStatusChange: (status) => updateChatBtn('tw', status),
});

function updateChatBtn(platform, status) {
  const btn = document.getElementById(`btn-${platform}-chat`);
  if (status === 'live') {
    btn.textContent = 'チャット停止';
    btn.classList.add('is-live');
    setStatus(`${platform === 'yt' ? 'YouTube' : 'Twitch'} チャット受信中`, 'ok');
  } else if (status === 'connecting') {
    btn.textContent = '接続中…';
    btn.classList.remove('is-live');
  } else {
    btn.textContent = 'チャット開始';
    btn.classList.remove('is-live');
  }
}

// ===== 設定の復元（起動時） =====

async function init() {
  const s = await loadSettings();

  setValue('yt-url',     s.ytUrl);
  setValue('tw-url',     s.twUrl);
  setValue('yt-start',   s.ytStart);
  setValue('tw-start',   s.twStart);
  setValue('yt-api-key', s.ytApiKey);
  setValue('tw-parent',  s.twParent);
  setValue('tw-relay',   s.twRelayUrl);

  if (s.ytStart)  syncManager.setStartTime('yt', s.ytStart);
  if (s.twStart)  syncManager.setStartTime('tw', s.twStart);
  if (s.ytApiKey) ytChat.updateApiKey(s.ytApiKey);

  // Twitch プレイヤーの接続設定を反映
  twPlayer.setParent(s.twParent || 'localhost');
  if (s.twRelayUrl) twPlayer.setRelayUrl(s.twRelayUrl);

  vertical = s.layout === 'vertical' || window.matchMedia('(max-width: 640px)').matches;
  applyLayout(vertical);
}

// ===== UI イベント =====

// YouTube 読込
document.getElementById('btn-yt-load').addEventListener('click', () => {
  const raw     = document.getElementById('yt-url').value.trim();
  const videoId = parseYouTubeId(raw);
  if (!videoId) { setStatus('YouTube: 有効なURLまたは動画IDを入力してください', 'error'); return; }

  if (ytChat.isRunning()) ytChat.stop();
  document.getElementById('btn-yt-chat').disabled = true;

  currentYtVideoId = videoId;
  ytPlayer.load(videoId);
  setStatus(`YouTube: "${videoId}" を読み込み中…`);
});

// Twitch 読込
document.getElementById('btn-tw-load').addEventListener('click', () => {
  const raw    = document.getElementById('tw-url').value.trim();
  const parsed = parseTwitchInput(raw);
  if (!parsed) { setStatus('Twitch: 有効なチャンネル名またはVOD URLを入力してください', 'error'); return; }

  if (twChat.isConnected()) twChat.disconnect();
  document.getElementById('btn-tw-chat').disabled = true;

  currentTwChannel = parsed.type === 'channel' ? parsed.id : null;
  twPlayer.load(parsed.id, parsed.type);
  const label = parsed.type === 'channel' ? 'チャンネル' : 'VOD';
  setStatus(`Twitch: ${label} "${parsed.id}" を読み込み中…`);
});

// URL: フォーカスアウトで保存
document.getElementById('yt-url').addEventListener('change', (e) => saveSettings({ ytUrl: e.target.value.trim() }));
document.getElementById('tw-url').addEventListener('change', (e) => saveSettings({ twUrl: e.target.value.trim() }));

// 配信開始時刻: バリデーション + 保存
document.getElementById('yt-start').addEventListener('change', (e) => {
  const ok = syncManager.setStartTime('yt', e.target.value);
  e.target.classList.toggle('invalid', !ok && e.target.value !== '');
  if (ok) saveSettings({ ytStart: e.target.value.trim() });
});
document.getElementById('tw-start').addEventListener('change', (e) => {
  const ok = syncManager.setStartTime('tw', e.target.value);
  e.target.classList.toggle('invalid', !ok && e.target.value !== '');
  if (ok) saveSettings({ twStart: e.target.value.trim() });
});

// YouTube API キー
document.getElementById('yt-api-key').addEventListener('change', (e) => {
  const key = e.target.value.trim();
  ytChat.updateApiKey(key);
  saveSettings({ ytApiKey: key });
});

// Twitch parent ドメイン
document.getElementById('tw-parent').addEventListener('change', (e) => {
  const val = e.target.value.trim() || 'localhost';
  twPlayer.setParent(val);
  saveSettings({ twParent: val });
});

// Twitch relay URL（設定するとリレーモードに切替）
document.getElementById('tw-relay').addEventListener('change', (e) => {
  const val = e.target.value.trim();
  twPlayer.setRelayUrl(val);
  saveSettings({ twRelayUrl: val });
  setStatus(val ? `Twitch: relay モード (${val})` : 'Twitch: SDK 直接モードに切替', 'ok');
});

// YouTube チャット開始 / 停止
document.getElementById('btn-yt-chat').addEventListener('click', () => {
  if (ytChat.isRunning()) { ytChat.stop(); return; }
  if (!currentYtVideoId) { setStatus('先に YouTube 動画を読み込んでください', 'error'); return; }
  const apiKey = document.getElementById('yt-api-key').value.trim();
  if (!apiKey) { setStatus('YouTube Data API v3 キーを入力してください', 'error'); return; }
  ytChat.updateApiKey(apiKey);
  ytChat.start(currentYtVideoId);
});

// Twitch チャット開始 / 停止
document.getElementById('btn-tw-chat').addEventListener('click', () => {
  if (twChat.isConnected()) { twChat.disconnect(); return; }
  if (!currentTwChannel) { setStatus('先に Twitch チャンネルを読み込んでください', 'error'); return; }
  twChat.connect(currentTwChannel);
});

// 同期ボタン
document.getElementById('btn-sync').addEventListener('click', () => {
  const result = syncManager.sync('yt', 'tw');
  setStatus(result.message, result.ok ? 'ok' : 'error');
});

// レイアウト切替
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
  } catch { /* invalid URL */ }
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
  } catch { /* not a URL */ }
  if (/^[A-Za-z0-9_]{1,25}$/.test(raw)) return { id: raw, type: 'channel' };
  return null;
}

// ===== デモコメント =====
const DEMO_COMMENTS = ['w','ｗｗｗ','すごい！','GG','ナイス！','おつ！','えっ！？','笑','神','優勝！'];
let demoTimer = null;

export function startDemoComments() {
  if (demoTimer) return;
  demoTimer = setInterval(() => {
    const text  = DEMO_COMMENTS[Math.floor(Math.random() * DEMO_COMMENTS.length)];
    const color = `hsl(${Math.random() * 360},90%,70%)`;
    ytOverlay.addComment(text, { color });
    if (Math.random() > 0.4) twOverlay.addComment(text, { color });
  }, 700);
}

export function stopDemoComments() {
  clearInterval(demoTimer);
  demoTimer = null;
}

init().catch(console.error);

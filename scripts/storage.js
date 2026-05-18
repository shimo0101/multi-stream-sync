/**
 * 設定の永続化。
 * GitHub Pages (通常の Web ページ) では localStorage を使用。
 * moz-extension:// コンテキストでは browser.storage.local を使用。
 */

const STORAGE_KEY = 'multi-stream-sync-settings';

const DEFAULTS = {
  panelCount:   2,
  layout:       'lp2-h',
  syncRefIdx:   0,
  // パネル 0〜3（最大4枚）
  p0Platform: 'youtube', p0Url: '', p0Start: '',
  p1Platform: 'twitch',  p1Url: '', p1Start: '',
  p2Platform: 'youtube', p2Url: '', p2Start: '',
  p3Platform: 'youtube', p3Url: '', p3Start: '',
  // 共通
  ytApiKey:    '',
  ytRelayUrl:  '',
  twParent:    'localhost',
  twRelayUrl:  '',
  twClientId:  '',
  // パネル表示順（インデックス i のパネルに CSS order = visualOrder[i] を適用）
  visualOrder: [],
};

const useExtStorage =
  typeof browser !== 'undefined' && browser.storage?.local != null;

export async function loadSettings() {
  if (useExtStorage) {
    const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
    return { ...DEFAULTS, ...stored };
  }
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(partial) {
  const valid = Object.fromEntries(
    Object.entries(partial).filter(([k]) => k in DEFAULTS)
  );
  if (!Object.keys(valid).length) return;

  if (useExtStorage) {
    await browser.storage.local.set(valid);
  } else {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...valid }));
    } catch {}
  }
}

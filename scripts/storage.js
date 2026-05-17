/**
 * 設定の永続化。
 * GitHub Pages (通常の Web ページ) では localStorage を使用。
 * moz-extension:// コンテキストでは browser.storage.local を使用。
 */

const STORAGE_KEY = 'multi-stream-sync-settings';

const DEFAULTS = {
  // パネル 0
  p0Platform:   'youtube',
  p0Url:        '',
  p0Start:      '',
  // パネル 1
  p1Platform:   'twitch',
  p1Url:        '',
  p1Start:      '',
  // 共通
  layout:       'horizontal',
  ytApiKey:     '',
  ytRelayUrl:   '',
  twParent:     'localhost',
  twRelayUrl:   '',
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

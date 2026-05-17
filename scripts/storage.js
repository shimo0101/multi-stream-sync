/**
 * browser.storage.local を使った設定永続化の薄いラッパー。
 * スキーマはここで一元管理し、未保存キーにはデフォルト値を返す。
 */

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
  ytRelayUrl:   '',           // youtube-relay/relay.html の URL
  twParent:     'localhost',  // Twitch Embed の parent ドメイン（sdk モード）
  twRelayUrl:   '',           // twitch-relay/relay.html の URL
};

export async function loadSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  const valid = Object.fromEntries(
    Object.entries(partial).filter(([k]) => k in DEFAULTS)
  );
  if (Object.keys(valid).length > 0) {
    await browser.storage.local.set(valid);
  }
}

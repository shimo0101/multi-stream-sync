/**
 * browser.storage.local を使った設定永続化の薄いラッパー。
 * スキーマはここで一元管理し、未保存キーにはデフォルト値を返す。
 */

const DEFAULTS = {
  ytUrl:      '',
  twUrl:      '',
  ytStart:    '',
  twStart:    '',
  layout:     'horizontal',
  ytApiKey:   '',
  twParent:   'localhost',  // Twitch Embed の parent ドメイン（sdk モード）
  twRelayUrl: '',           // relay.html の URL（設定時は relay モードになる）
};

/** 保存済み設定を取得する。未保存のキーはデフォルト値で補完される。 */
export async function loadSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

/**
 * 設定を部分的に保存する。スキーマ外のキーは無視される。
 * @param {Partial<typeof DEFAULTS>} partial
 */
export async function saveSettings(partial) {
  const valid = Object.fromEntries(
    Object.entries(partial).filter(([k]) => k in DEFAULTS)
  );
  if (Object.keys(valid).length > 0) {
    await browser.storage.local.set(valid);
  }
}

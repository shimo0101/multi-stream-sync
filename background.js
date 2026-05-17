// ツールバーボタン押下時にダッシュボードを開く（既存タブがあればフォーカス）
browser.action.onClicked.addListener(async () => {
  const dashboardUrl = browser.runtime.getURL("dashboard/dashboard.html");
  const existing = await browser.tabs.query({ url: dashboardUrl });

  if (existing.length > 0) {
    const tab = existing[0];
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await browser.windows.update(tab.windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url: dashboardUrl });
  }
});

// ===== Twitch CSP 除去 =====
// Twitch の player.twitch.tv は "frame-ancestors <relay-origin>" を返すが、
// moz-extension:// が祖先フレームに含まれるため拒否される。
// relay.html のオリジンから読み込まれた sub_frame に限定して CSP / X-Frame-Options を除去する。

let twRelayOrigin = '';

async function updateRelayOrigin() {
  try {
    const data = await browser.storage.local.get('twRelayUrl');
    twRelayOrigin = data.twRelayUrl ? new URL(data.twRelayUrl).origin : '';
  } catch {
    twRelayOrigin = '';
  }
}

updateRelayOrigin();
browser.storage.onChanged.addListener((changes) => {
  if ('twRelayUrl' in changes) updateRelayOrigin();
});

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!twRelayOrigin) return {};
    if (!(details.documentUrl ?? '').startsWith(twRelayOrigin)) return {};
    return {
      responseHeaders: details.responseHeaders.filter(h => {
        const name = h.name.toLowerCase();
        return name !== 'content-security-policy' && name !== 'x-frame-options';
      }),
    };
  },
  { urls: ['https://player.twitch.tv/*'], types: ['sub_frame'] },
  ['blocking', 'responseHeaders']
);

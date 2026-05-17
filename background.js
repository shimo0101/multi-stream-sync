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
// Twitch の frame-ancestors CSP が moz-extension:// をブロックするため、
// player.twitch.tv のサブフレームレスポンスから CSP と X-Frame-Options を除去する。

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    console.log('[MSS] webRequest intercept:', details.url, 'doc:', details.documentUrl);
    const filtered = details.responseHeaders.filter(h => {
      const name = h.name.toLowerCase();
      const drop = name === 'content-security-policy' || name === 'x-frame-options';
      if (drop) console.log('[MSS] dropped header:', h.name, '=', h.value);
      return !drop;
    });
    return { responseHeaders: filtered };
  },
  { urls: ['https://player.twitch.tv/*'], types: ['sub_frame'] },
  ['blocking', 'responseHeaders']
);

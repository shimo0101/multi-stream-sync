// ツールバーボタン押下時にダッシュボードを開く（既存タブがあればフォーカス）
// ダッシュボードは GitHub Pages で動作し、moz-extension:// の制約を受けない。
const DASHBOARD_URL =
  'https://shimo0101.github.io/multi-stream-sync/dashboard/dashboard.html';

browser.action.onClicked.addListener(async () => {
  const tabs = await browser.tabs.query({ url: DASHBOARD_URL });

  if (tabs.length > 0) {
    const tab = tabs[0];
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await browser.windows.update(tab.windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url: DASHBOARD_URL });
  }
});

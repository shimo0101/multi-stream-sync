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

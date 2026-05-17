# MultiStream Sync — 実装概要・運用手順書

> 作成日: 2026-05-17  
> バージョン: 0.1.0（コミット `5a2c438`）

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [システム構成](#2-システム構成)
3. [ファイル構成](#3-ファイル構成)
4. [実装済み機能](#4-実装済み機能)
5. [起動・セットアップ手順](#5-起動セットアップ手順)
6. [各機能の使い方](#6-各機能の使い方)
7. [今後の改善点](#7-今後の改善点)
8. [リスク・制約事項](#8-リスクと制約事項)

---

## 1. プロジェクト概要

YouTube と Twitch の複数配信を1画面で同時視聴するための **Firefox 拡張機能**。

- 配信開始時刻を基準にした手動時刻同期
- ニコニコ動画風のコメントオーバーレイ（ロール別カラーリング・アバター表示）
- 1〜4 パネルのフレキシブルレイアウト
- チャンネルブラウザによるお気に入り管理

対象環境: **Firefox (PC / Android)** ※ Chrome 非対応（Android Chrome は拡張機能自体が非対応）

---

## 2. システム構成

```
┌─────────────────────────────────────────────────────────────────┐
│  Firefox ブラウザ                                                │
│                                                                  │
│  ┌─────────────────────┐   クリック    ┌─────────────────────┐  │
│  │  拡張機能           │ ──────────── ▶│  ダッシュボード      │  │
│  │  (background.js)    │  タブを開く   │  (GitHub Pages)     │  │
│  └─────────────────────┘              └──────────┬──────────┘  │
│                                                  │              │
│              iframe × N パネル                   │              │
│   ┌──────────────────┐  ┌──────────────────┐    │              │
│   │ youtube-relay    │  │  twitch-relay    │◀───┘              │
│   │ /relay.html      │  │  /relay.html     │  postMessage      │
│   │ (YouTube IFrame  │  │  (Twitch Embed   │  (双方向)         │
│   │  API)            │  │   JS API)        │                   │
│   └──────────────────┘  └──────────────────┘                   │
│                                                                  │
│  外部 API アクセス（ダッシュボードから直接）                      │
│    YouTube Data API v3 ─ チャット取得・開始時刻取得              │
│    Twitch IRC (WSS)    ─ チャット受信                            │
└─────────────────────────────────────────────────────────────────┘
```

### なぜ relay.html が必要か

| 問題 | 影響範囲 | 解決策 |
|------|----------|--------|
| YouTube IFrame API は `moz-extension://` オリジンでは動作しない | YouTube 再生全般 | `youtube-relay/relay.html` を GitHub Pages に配置し iframe 経由で制御 |
| Twitch の `frame-ancestors` CSP が `moz-extension://` を許可しない | Twitch 埋め込み | `twitch-relay/relay.html` を GitHub Pages（Twitch の許可済みドメイン）に配置 |

ダッシュボード自体も GitHub Pages で配信することで、上記 relay.html と同一オリジンとなり postMessage 通信が確立できる。

---

## 3. ファイル構成

```
multi-stream-sync/
├── manifest.json               Firefox MV3 拡張マニフェスト
├── background.js               ツールバークリック → ダッシュボードタブを開く
├── icons/
│   ├── icon.svg
│   ├── icon-48.png
│   └── icon-96.png
│
├── dashboard/                  ▶ GitHub Pages で公開するメイン UI
│   ├── dashboard.html          UI テンプレート
│   ├── dashboard.css           スタイルシート
│   └── dashboard.js            UI 制御・パネル管理・同期ロジック
│
├── scripts/                    ▶ ダッシュボードから import されるモジュール
│   ├── youtube-player.js       YouTube relay 経由のプレイヤー制御
│   ├── twitch-player.js        Twitch relay / SDK プレイヤー制御
│   ├── youtube-chat.js         YouTube Data API v3 チャットポーリング
│   ├── twitch-chat.js          Twitch IRC over WebSocket クライアント
│   ├── comment-overlay.js      Canvas コメントオーバーレイ
│   ├── sync-manager.js         配信開始時刻基準の時刻同期計算
│   └── storage.js              設定の永続化（localStorage / browser.storage.local）
│
├── youtube-relay/
│   └── relay.html              YouTube IFrame API のブリッジページ
│
└── twitch-relay/
    └── relay.html              Twitch Embed JS API のブリッジページ
```

---

## 4. 実装済み機能

### 4-1. パネル管理

| 機能 | 状態 | 詳細 |
|------|------|------|
| パネル数変更（1〜4） | ✅ | トップバーの ＋ / － ボタン |
| レイアウト切替 | ✅ | CSS Grid。横並び・縦並び・左大＋右2段 等 |
| パネルのドラッグ並び替え | ✅ | ⠿ ハンドルをドラッグ。CSS `order` で視覚的に入れ替え |
| 並び順リセット | ✅ | ↺ ボタンでデフォルト順に戻す |
| ツールバー折りたたみ | ✅ | パネルごとに ▲/▼ ボタン |
| 全画面モード | ✅ | F キーまたは「全画面」ボタン。トップバー・設定・ステータスバーを非表示 |
| 設定の自動保存 | ✅ | URL・プラットフォーム・開始時刻・レイアウト・パネル数・並び順を localStorage に保存 |

### 4-2. 動画再生

| 機能 | 状態 | 詳細 |
|------|------|------|
| YouTube 再生 | ✅ | youtube-relay 経由で IFrame API |
| Twitch チャンネル再生 | ✅ | twitch-relay 経由で Embed JS API |
| Twitch VOD 再生 | ✅ | twitch-relay 経由（`/videos/xxx` URL 対応） |
| URL 自動判別 | ✅ | youtu.be / youtube.com / twitch.tv → プラットフォーム自動切替 |

### 4-3. 時刻同期

| 機能 | 状態 | 詳細 |
|------|------|------|
| 手動同期 | ✅ | 「⏱ 同期」ボタン。基準パネルの「配信開始時刻 + 再生位置 = 実時間」で計算しシーク |
| 開始時刻の手動入力 | ✅ | HH:MM:SS 形式 |
| 開始時刻の自動取得 | ✅ | YouTube Data API v3 の `liveStreamingDetails.actualStartTime` を利用 |
| 開始時刻の微調整 | ✅ | −5s / −1s / +1s / +5s ボタン |
| 同期基準パネル選択 | ✅ | セレクターで選択。パネル並び替え後は視覚順に連動して P1/P2 を更新 |

### 4-4. ライブチャット

| 機能 | 状態 | 詳細 |
|------|------|------|
| YouTube ライブチャット受信 | ✅ | Data API v3 `liveChat.messages.list` をポーリング。最短 5 秒間隔（API 指定値に従う） |
| Twitch チャット受信 | ✅ | `wss://irc-ws.chat.twitch.tv:443` への匿名 IRC 接続（API Key 不要） |
| ロール別カラーリング | ✅ | 配信者（金）・モデレーター（青）・メンバー/サブスクライバー（緑）・一般（白半透明） |
| アバター表示 | ✅ | YouTube のメンバー以上のみ。Canvas に円形クリップで描画 |

### 4-5. コメントオーバーレイ

| 機能 | 状態 | 詳細 |
|------|------|------|
| ニコニコ風流れるコメント | ✅ | Canvas + requestAnimationFrame。220px/秒で右→左 |
| レーン管理（重複軽減） | ✅ | 10 レーン。各レーンの最終コメント右端が画面外に出るまで同一レーンを再利用しない |
| アバターの先行ロード | ✅ | `Map<url, HTMLImageElement>` によるキャッシュ。crossOrigin 設定済み |
| フォントサイズ自動調整 | ✅ | レーン高さに応じて 14〜22px の範囲で可変 |
| 縁取り | ✅ | 黒縁取りで背景映像上でも視認性を確保 |

### 4-6. チャンネルブラウザ

| 機能 | 状態 | 詳細 |
|------|------|------|
| お気に入りチャンネル管理 | ✅ | YouTube / Twitch を別タブで管理。localStorage に永続化 |
| YouTube チャンネル追加 | ✅ | @ハンドル または チャンネルID で追加。Data API v3 でチャンネル名・アイコンを取得 |
| YouTube ライブ確認 | ✅ | 「ライブ確認」ボタンで `search.list?eventType=live` を全チャンネル並列実行 |
| パネルへの読み込み | ✅ | P1〜P4 ボタン。YouTube はライブ中のみ有効。Twitch は常時有効 |
| Twitch チャンネル追加 | ✅ | ユーザー名のみ。API 不要 |

---

## 5. 起動・セットアップ手順

### 前提条件

- Firefox 109.0 以上（PC）または 120.0 以上（Android）
- YouTube Data API v3 の API Key（チャット・開始時刻取得・チャンネルブラウザに必要）

### 手順 A: 拡張機能をインストールする（PC）

1. このリポジトリを `git clone` またはダウンロード（ZIP 展開）
2. Firefox を開き、アドレスバーに `about:debugging#/runtime/this-firefox` を入力
3. 「一時的なアドオンを読み込む」→ `manifest.json` を選択
4. ツールバーに **MultiStream Sync** アイコンが表示されれば完了
5. アイコンをクリックするとダッシュボードが開く

> **注意**: 一時的なアドオンはブラウザを閉じるたびに解除される。常用するには AMO（Firefox Add-on Store）への署名申請が必要（未実施）。

### 手順 B: YouTube API Key を取得する

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「API とサービス」→「ライブラリ」→「YouTube Data API v3」を有効化
3. 「認証情報」→「API キーを作成」→ キーをコピー
4. ダッシュボードの ⚙（共通設定）→「YouTube API Key」に貼り付け

### 手順 C: ダッシュボードを設定する

ダッシュボードは GitHub Pages（`https://shimo0101.github.io/multi-stream-sync/dashboard/dashboard.html`）で動作する。初回アクセス時に relay URL が自動設定される。

| 設定項目 | 自動設定 | 手動変更が必要なケース |
|----------|----------|----------------------|
| YouTube relay URL | ✅ GitHub Pages の relay.html | ローカル開発時のみ `http://localhost:8080/youtube-relay/relay.html` |
| Twitch relay URL | ✅ GitHub Pages の relay.html | ローカル開発時のみ |
| Twitch parent | ✅ `shimo0101.github.io` | ローカル開発時は `localhost` |
| YouTube API Key | ❌ | 手順 B で取得したキーを入力 |

### 手順 D: 動画を視聴する

1. パネルの URL 欄に YouTube URL または Twitch チャンネル名を入力
2. 「読込」ボタンをクリック
3. プレイヤーが準備完了になったら「チャット開始」で流れるコメントが有効になる

### 手順 E: 同期する（アーカイブ視聴時）

1. 各パネルの「配信開始」欄に `HH:MM:SS` 形式で配信開始時刻を入力
   - YouTube の場合: 「⬇ 自動」ボタンで API から自動取得可能
2. 基準パネル（同期の起点）を選択
3. 基準パネルを再生した状態で「⏱ 同期」をクリック

---

## 6. 各機能の使い方

### チャンネルブラウザ

1. トップバーの「チャンネル」ボタンをクリックしてサイドバーを開く
2. **YouTube タブ**: `@ハンドル`（例: `@hololive`）または チャンネルID（`UCxxx`）を入力して「追加」
   - YouTube API Key が必要
3. 「ライブ確認」→ ライブ中のチャンネルに P1〜P4 ボタンが有効になる
4. **Twitch タブ**: チャンネル名を入力して「追加」→ P1〜P4 ボタンでいつでも開ける

### パネルの並び替え

- 各パネル左端の `⠿` ハンドルをドラッグして別パネルにドロップ
- 同期セレクターの P1/P2 ラベルは視覚的な位置順に自動更新される
- ↺ ボタンでデフォルト順（P1 が左/上）に戻す

---

## 7. 今後の改善点

### 優先度 高

| 項目 | 概要 |
|------|------|
| **アーカイブチャットのオーバーレイ** | `yt-dlp` で取得した `.live_chat.json` を読み込み、アーカイブ視聴中に再生位置に合わせてコメントを流す。ユーザーが CLI を実行してファイルをブラウザに渡す UX が必要（ドラッグ&ドロップ等）。 |
| **Twitch ライブ状態確認** | チャンネルブラウザで Twitch のライブ中/オフラインを表示する。Twitch Helix API（`/helix/streams`）は Client ID + アクセストークンが必要。App Access Token 取得にはサーバーサイドが必要なため、現状は未実装。 |
| **AMO 署名・配布** | 現状は「一時的なアドオン」のため、Firefox を閉じると解除される。Firefox Add-on Store への申請で署名を取得することで恒久インストールが可能になる。 |

### 優先度 中

| 項目 | 概要 |
|------|------|
| **自動同期** | 現在は手動ボタン押下のみ。定期的に自動で同期するオプション（例: 30 秒ごと）を追加。 |
| **コメント速度・密度の設定** | コメント流速（px/秒）とレーン数をユーザーが調整できるスライダー。 |
| **音量コントロール** | パネルごとの音量を UI から調整。現状はプレイヤー内蔵コントロールのみ。 |
| **パネルにラベル表示** | 並び替え後も視覚的な P1/P2 番号をパネル上に表示することで混乱を防ぐ。 |
| **設定のエクスポート/インポート** | localStorage の設定を JSON ファイルで書き出し・読み込み。マルチデバイス運用に対応。 |
| **チャット自動開始** | 動画読み込み後に自動でチャット受信を開始するオプション。 |

### 優先度 低

| 項目 | 概要 |
|------|------|
| **キーボードショートカット** | 同期・全画面切替以外の操作にも対応。 |
| **コメントフィルタリング** | キーワードフィルタ・スパム検出（連投・長文）。 |
| **Android UI 最適化** | 現状 `gecko_android` 対応はマニフェストのみ。タッチ操作に特化した UI 調整が必要。 |
| **テーマ切替** | 現状はダークテーマ固定。ライトテーマオプション。 |
| **通知機能** | お気に入りチャンネルが配信を開始したときにブラウザ通知を出す。 |

---

## 8. リスクと制約事項

### 8-1. API・プラットフォームリスク

| リスク | 影響 | 対策状況 |
|--------|------|----------|
| **YouTube IFrame API の仕様変更** | 動画再生が停止 | relay.html は最小限の実装。仕様変更追従が必要 |
| **YouTube Data API v3 クォータ制限** | チャット・チャンネル検索が停止 | 1日 10,000 ユニット（`liveChat.messages.list`: 5 units/call, `search.list`: 100 units/call）。ライブ確認は手動のみにしてコストを抑えている |
| **Twitch IRC プロトコル変更** | チャット受信が停止 | Twitch は公式に IRC over WebSocket をサポートしているが、将来的な廃止リスクあり |
| **Twitch Embed CSP の変更** | Twitch 動画が表示されなくなる | GitHub Pages ドメインが Twitch の許可リストから削除された場合、relay.html が機能しなくなる |
| **GitHub Pages の仕様変更** | ダッシュボード全体が動作不能 | CDN キャッシュ問題は `?v=N` クエリパラメータで緩和済み |

### 8-2. セキュリティリスク

| リスク | 詳細 |
|--------|------|
| **API Key の漏洩** | YouTube API Key は localStorage に平文保存。悪意ある拡張機能や XSS で読み取られる可能性あり。現状は個人利用を前提としており許容範囲 |
| **postMessage の送信先検証** | relay.html は `'*'` オリジンで postMessage を送受信。悪意ある iframe が同一ページにあると情報漏洩の可能性。ダッシュボードは自身の iframe のみ生成するため実害は限定的 |
| **XSS** | チャンネルブラウザのリスト描画で `escHtml()` による HTML エスケープ済み。YouTube チャットの `displayMessage` はコメントオーバーレイ（Canvas）に描画するため DOM 注入リスクなし |

### 8-3. 技術的制約

| 制約 | 詳細 |
|------|------|
| **拡張機能なしでの動作不可** | ダッシュボード URL（GitHub Pages）は拡張機能なしでも直接開ける。ただし拡張機能ボタンからの起動が前提 |
| **Chrome 非対応** | manifest.json に `browser_specific_settings.gecko` を使用。Chrome には移植可能だが Twitch CSP 回避の実装が異なる（Chrome MV3 では `declarativeNetRequest` を使う必要がある） |
| **設定はデバイスローカル** | localStorage または `browser.storage.local` のみ。Firefox Sync や クラウド同期には非対応 |
| **YouTube アーカイブのチャット非対応** | YouTube Data API は VOD のチャットログ取得に対応していない。yt-dlp での別途取得が必要（未実装） |
| **同期は手動のみ** | 実時間のズレは自動補正されない。ネットワーク遅延・バッファリングは考慮外 |
| **再生位置の取得精度** | YouTube は 500ms ポーリング、Twitch は 1000ms ポーリング。最大 1 秒の誤差が生じる |
| **Android タッチ操作** | ドラッグ並び替えは `mousedown` イベントを使用しており、タッチデバイスでは動作しない |

### 8-4. 運用上の注意

- **ページリロード時**: セッション中の Twitch チャット接続は切断される。再起動後に「チャット開始」の再押下が必要
- **一時的なアドオン**: Firefox 再起動で拡張機能が無効化される。毎回 `about:debugging` から再ロードが必要（AMO 署名前）
- **YouTube の同時接続数**: 同一ブラウザで複数パネルに YouTube を表示する場合、ブラウザのコネクション数制限に注意
- **GitHub Pages CDN**: ファイル更新後、CDN にキャッシュが残る場合は `?v=N` のバージョン番号を更新してハードリフレッシュを行う

---

*最終更新: 2026-05-17*

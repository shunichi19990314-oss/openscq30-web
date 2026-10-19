# Render へのデプロイ手順

OpenSCQ30 Web は**完全にクライアントサイド**で動くアプリです。Bluetooth 通信はブラウザ内の
Web Serial API が直接行うため、Render 側には**静的ファイルを配信するだけ**の役割しかありません。
つまり無料枠の Static Site で十分で、サーバーの常駐コストも発生しません。

## 前提

- GitHub（または GitLab / Bitbucket）に push されたリポジトリ
- Render アカウント（無料プランで可）
- Node 20 系（Render 側で `NODE_VERSION` により指定）

## 方法 A: Blueprint（`render.yaml`）を使う

リポジトリ直下の `render.yaml` に、ビルドコマンド・公開ディレクトリ・セキュリティヘッダー・
SPA 用の rewrite がすべて定義済みです。

1. Render ダッシュボード → **New +** → **Blueprint**
2. 対象リポジトリ（とブランチ）を選択
3. 内容を確認して **Apply**

`openscq30-web` という Static Site が作成され、push のたびに自動デプロイされます。
Pull Request プレビューも有効（`pullRequestPreviewEnabled: true`）なので、PR ごとに
`https://<service>-<pr番号>.onrender.com` のような URL で確認できます。

### `render.yaml` の要点

| 項目 | 値 | 説明 |
| --- | --- | --- |
| `runtime` | `static` | 静的サイト。サーバープロセスは起動しない |
| `buildCommand` | `npm ci && npm run build` | 型チェック（`tsc --noEmit`）→ Vite ビルド |
| `staticPublishPath` | `./dist` | Vite の出力先 |
| `headers` | CSP ほか | `script-src 'self'` などの最小構成 |
| `routes` | `/* → /index.html` | SPA rewrite |
| `envVars.NODE_VERSION` | `20.17.0` | ビルド時の Node バージョン固定 |

## 方法 B: 手動で Static Site を作る

1. Render → **New +** → **Static Site**
2. リポジトリを選択
3. 設定
   - **Name**: 任意（例 `openscq30-web`）
   - **Branch**: `main`
   - **Build Command**: `npm ci && npm run build`
   - **Publish Directory**: `dist`
   - **Environment Variables**: `NODE_VERSION` = `20.17.0`
4. **Create Static Site**

## デプロイ後の確認

1. `https://<your-app>.onrender.com` を **Chrome または Edge** で開く
2. トップページに「イヤホンに接続する」「デモ機器で試す」が出る
3. 「デモ機器で試す」で設定画面が出ることを確認（実機不要の動作確認）
4. 実機は OS でペアリングしてから「イヤホンに接続する」→ 一覧から Soundcore を選択

`https` で配信されている限り Web Serial の secure context 要件は満たされます。
Render の `onrender.com` ドメインは HTTPS + 有効な証明書なので追加設定は不要です。

## 独自ドメインを使う場合

Render の Static Site に独自ドメインを追加しても HTTPS は自動発行されます。
Web Serial は origin 単位で権限を記憶するため、**ドメインを変えると機器の許可はやり直し**になります。

## トラブルシュート

| 症状 | 原因と対処 |
| --- | --- |
| 「このブラウザからは接続できません」 | Safari / Firefox / iOS。Chrome・Edge・Android Chrome を使う |
| 「Web Serial はセキュアコンテキストでのみ…」 | `http://` で開いている。HTTPS（または `localhost`）で開く |
| 選択ダイアログに何も出ない | OS 側で未ペアリング、または他アプリが RFCOMM を占有。公式アプリ／デスクトップ版を閉じる |
| 選択しても接続に失敗する | サービス UUID が違う可能性。「詳細設定」で UUID を追加して再試行 |
| 接続できるが設定が読み込めない | ファームウェア差異で state update パケットの長さが違う可能性。通信ログの 16 進を本家 issue に添えて報告すると解析が進みます |
| ビルドが失敗する | `NODE_VERSION` が古いか、`package-lock.json` を commit し忘れている（`npm ci` は lock 必須） |

## iframe 埋め込みについて

Web Serial は Permissions Policy の対象です。他サイトから iframe で埋め込む場合は
埋め込み側に `allow="serial"` が必要です。本リポジトリの `render.yaml` は
`Permissions-Policy: serial=(self), bluetooth=(self)` を送出しているため、
**同一 origin 以外からの埋め込みでは実機接続ができません**（デモモードは動作します）。
埋め込みを許可したい場合はこのヘッダーを外してください。

## CI

`.github/workflows/ci.yaml` が push / PR で型チェック・テスト・ビルドを実行し、
`dist/` をアーティファクトとして保存します。Render のデプロイとは独立しているので、
GitHub Actions 側からデプロイをトリガーする構成（`render.yaml` を使わない方法）に変えることもできます。

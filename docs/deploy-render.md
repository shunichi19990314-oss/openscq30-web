# Render へのデプロイ（Blueprint 以外を含む全方法）

OpenSCQ30 Web は**完全にクライアントサイド**のアプリです。Bluetooth 通信はブラウザ内の Web Serial
API が直接行うため、ホスティング側は**静的ファイルを HTTPS で配信するだけ**で動きます。
サーバープロセスもデータベースも不要です。

> **共通の必須条件**: Web Serial は **secure context**（HTTPS または `http://localhost`）でのみ
> 使えます。Render の `*.onrender.com` は HTTPS なので追加設定は不要です。

| 方法 | 必要なもの | 自動デプロイ | 用途 |
| --- | --- | --- | --- |
| [A. Dashboard で Static Site を手動作成](#a-dashboard-で-static-site-を手動作成) | Render アカウント | push で自動 | **一番簡単（おすすめ）** |
| [B. Deploy Hook](#b-deploy-hook-でデプロイをトリガーする) | 既存サービス | CI 経由で任意のタイミング | ビルドを CI の後に回したいとき |
| [C. Render API](#c-render-api-でサービスを作成する) | API Key | push で自動 | スクリプト／IaC から作りたいとき |
| [D. Render CLI](#d-render-cli-で作成する) | CLI トークン | push で自動 | ターミナルから作りたいとき |
| [E. Blueprint](#e-blueprint-renderyaml) | GitHub 連携 | push で自動 | `render.yaml` を使う（参考） |

---

## A. Dashboard で Static Site を手動作成

`render.yaml` を一切使わない方法です。

1. https://dashboard.render.com/ → **New +** → **Static Site**
2. **Connect a Git provider** で GitHub を連携し、`shunichi19990314-oss/openscq30-web` を選択
3. 設定を入力

   | 項目 | 値 |
   | --- | --- |
   | Name | `openscq30-web`（任意） |
   | Region | 近いもの（例: Singapore / Tokyo） |
   | Branch | `main` |
   | Root Directory | （空 = リポジトリ直下） |
   | Runtime | **Node** |
   | Build Command | `npm ci && npm run build` |
   | Publish Directory | `dist` |
   | Plan | **Free** |

4. **Advanced** → **Environment Variables** に追加

   | Key | Value |
   | --- | --- |
   | `NODE_VERSION` | `20.17.0` |

   （未指定だと古い Node が使われてビルドが失敗することがあります）

5. **Create Static Site**

数分で `https://<name>.onrender.com` が発行されます。以降 `main` への push で自動デプロイされます。

### ヘッダーや SPA rewrite を後から足す

手動作成した場合、`render.yaml` のヘッダー（CSP など）は適用されません。必要なら
**Settings → Headers & Routes**（または **Rewrites and Redirects**）から追加できます。

- Header: `Content-Security-Policy` = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'`
- Header: `Permissions-Policy` = `serial=(self), bluetooth=(self)`
- Rewrite: `/*` → `/index.html`（本アプリは単一ルートなので任意）

本アプリは外部スクリプト・外部フォント・通信先を一切使わないので、CSP はあってもなくても動作します。

---

## B. Deploy Hook でデプロイをトリガーする

サービスを作成したあと、**任意のタイミングでビルドを走らせる**方法です。
「GitHub Actions のテストが通ったらデプロイする」構成にできます。

1. Render Dashboard → 対象サービス → **Settings** → **Deploy Hook** の URL をコピー
   （`https://api.render.com/deploy/srv-XXXX?key=YYYY` の形式。**この URL は秘密情報**です）
2. GitHub リポジトリ → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret** に `RENDER_DEPLOY_HOOK_URL` として登録
3. ワークフローから叩く

```yaml
# .github/workflows/deploy.yaml
name: deploy
on:
  push:
    branches: [main]

jobs:
  test-then-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
      - name: Trigger Render deploy
        env:
          deploy_url: ${{ secrets.RENDER_DEPLOY_HOOK_URL }}
        run: curl -fsS "$deploy_url"
```

手元から手動でトリガーする場合:

```bash
curl "https://api.render.com/deploy/srv-XXXX?key=YYYY"
# → 200 {"deploy":{"id":"dep-..."}}  = デプロイ開始
# → 202 = 別のデプロイが実行中（完了後に順次実行）
```

特定のコミットだけデプロイしたい場合は `&ref=<commit-sha>` を付けます。

> Render 側で **Settings → Auto-Deploy** を `No` にしておくと、push では勝手にデプロイされず、
> Deploy Hook（または手動 Deploy）だけで制御できます。

---

## C. Render API でサービスを作成する

Dashboard を使わずにスクリプトで作成する方法です。

1. https://dashboard.render.com/account/api-keys で **API Key** を発行
2. Workspace ID を確認（Dashboard の **Workspace Settings** の URL に含まれる `ws-XXXX`）
3. サービスを作成

```bash
export RENDER_API_KEY=rnd-XXXXXXXX
export OWNER_ID=ws-XXXXXXXX

curl -sS -X POST "https://api.render.com/v1/services" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "static_site",
    "name": "openscq30-web",
    "ownerId": "'"$OWNER_ID"'",
    "repo": "https://github.com/shunichi19990314-oss/openscq30-web",
    "branch": "main",
    "autoDeployTrigger": "commit",
    "envVars": [{ "key": "NODE_VERSION", "value": "20.17.0" }],
    "staticSiteDetails": {
      "buildCommand": "npm ci && npm run build",
      "publishPath": "dist",
      "pullRequestPreviewsEnabled": "yes"
    }
  }'
```

レスポンスの `service.serviceDetails.url` が公開 URL、`service.dashboardUrl` が管理画面です。
作成と同時に初回ビルドが走ります。以降の操作は
`POST /v1/services/{id}/deploys`（デプロイ）、`GET /v1/services/{id}/deploys`（状態確認）など。

GitHub 連携がまだの場合は、先に Dashboard で GitHub アプリをインストールして
リポジトリへのアクセスを許可しておく必要があります。

---

## D. Render CLI で作成する

Render 公式 CLI（Go 製のバイナリ、npm パッケージではありません）。

```bash
# インストール（いずれか）
brew install render                                   # macOS
winget install render.cli                             # Windows
curl -fsSL https://raw.githubusercontent.com/render-oss/cli/refs/heads/main/bin/install.sh | sh

render login                 # ブラウザで Authorize CLI
render workspace set         # 対象ワークスペースを選択

# サービス作成（非対話モードのみ）
render services create \
  --repo https://github.com/shunichi19990314-oss/openscq30-web \
  --name openscq30-web

# デプロイのトリガーと完了待ち
render deploys create srv-XXXX --wait

# render.yaml の構文チェック（Blueprint を使う前に確認できる）
render blueprints validate ./render.yaml

# ログ確認
render logs srv-XXXX
```

CLI は `render.yaml` の**検証**にも使えるので、Blueprint を適用する前の確認に使えます。

---

## E. Blueprint（`render.yaml`）

参考までに、リポジトリには Blueprint 用の `render.yaml` が入っています
（ビルドコマンド・公開ディレクトリ・ヘッダー・SPA rewrite・`NODE_VERSION` を定義済み）。

- Dashboard → **New +** → **Blueprint** → リポジトリ選択 → **Apply**

Blueprint の利点は「ヘッダーや rewrite まで含めた構成がコードで管理される」ことです。
手動作成（A）との違いはそこだけで、ビルド結果は同一です。

---

## PWA とキャッシュ

`render.yaml` は次のキャッシュポリシーを送出します（Service Worker の更新が確実に届くため）。

| パス | Cache-Control |
| --- | --- |
| `/sw.js`, `/index.html`, `/manifest.webmanifest` | `no-cache` |
| `/assets/*` | `public, max-age=31536000, immutable` |
| その他 | 既定 |

デプロイ後は DevTools → Application で Service Worker が `activated & running` になっていること、
 Manifest に PNG アイコン（192/512, any/maskable）が認識されていることを確認してください。
 これで Chrome / Edge / Android から**ホーム画面にインストール**でき、2 回目以降はオフラインでも起動します。

## デプロイ後の動作確認

1. 発行された URL を **Chrome または Edge**（Android なら Chrome）で開く
2. トップページに「イヤホンに接続する」ボタンとブラウザ要件のチェックリストが出る
3. 実機: OS でペアリング → 「イヤホンに接続する」→ 一覧から Soundcore を選択
4. 設定画面は実機接続が確立した後にのみ表示されます

`chrome://inspect/#devices` ではなく、ページ上で **F12 → Console** を開くと
Web Serial のエラー理由が確認できます（`navigator.serial` が `undefined` なら
ブラウザ未対応か非セキュアコンテキスト）。

## うまくいかないとき

| 症状 | 原因と対処 |
| --- | --- |
| ビルドが `npm ci` で失敗 | `package-lock.json` が commit されているか（必須）。`NODE_VERSION` を 20 系に |
| 404 になる | Publish Directory が `dist`（`./dist` でも可）になっているか |
| 開くと真っ白 | `BASE_PATH` を付けてビルドしていないか（Render はドメイン直下なので不要） |
| 「このブラウザからは接続できません」 | Safari / Firefox / iOS。Chrome・Edge・Android Chrome を使う |
| 「Web Serial はセキュアコンテキストでのみ…」 | `http://` で開いている。HTTPS か `localhost` で開く |
| 選択ダイアログに何も出ない | OS 未ペアリング、または公式アプリ／デスクトップ版が RFCOMM を占有 |
| 接続できるが状態を読み込めない | ファームウェア差異。「通信ログ」の 16 進（特に `01 01` の応答）を控えて issue へ |

## Render を使わない場合

GitHub Pages / Cloudflare Pages / Netlify / Vercel / 自前 nginx、
および**デプロイせずに localhost で実機を触る方法**は
[docs/deploy-other-platforms.md](deploy-other-platforms.md) を参照してください。

# Render 以外でのホスティング / ローカル実行

本アプリは**静的ファイルだけ**で動くので、HTTPS で配信できる場所ならどこでも動きます。
サーバーサイドのコード・DB・シークレットは一切ありません。

```bash
npm ci
npm run build      # -> dist/  （型チェック込み）
```

生成される `dist/`（約 1 MB、gzip 後 74 KB の JS + 9 KB の CSS + index.html）を配信するだけです。

> **Web Serial の要件**: secure context（HTTPS または `http://localhost`）+
> Chrome / Edge 117 以降（デスクトップ）または Chrome 138 以降（Android）。
> Safari / Firefox / iOS 上の全ブラウザでは実機接続ができません（デモモードは動作）。

---

## 0. デプロイせずに実機で試す（最速）

**`http://localhost` は secure context として扱われる**ため、デプロイしなくても実機の P30i に接続できます。

```bash
npm ci
npm run dev        # http://localhost:5173
```

Chrome / Edge で `http://localhost:5173` を開き、OS 側でペアリング済みの P30i を選べば OK です。
まずはこれで動作確認してからホスティング先を決めるのがおすすめです。

LAN 内の別マシン（例: Android の Chrome）から試す場合は HTTPS が必要になります。
`npm run dev -- --host` では secure context にならない（`http://192.168.x.x` は不可）ので、
Cloudflare Tunnel などで HTTPS 化するか、下記のいずれかにデプロイしてください。

---

## 1. GitHub Pages

HTTPS で配信されるので Web Serial が使えます。リポジトリには
`.github/workflows/pages.yaml` を同梱してあります。

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. `main` に push する（または Actions タブから `pages` ワークフローを **Run workflow**）
3. `https://<user>.github.io/openscq30-web/` で公開される

サブパス配信になるため、ビルド時に `BASE_PATH` を指定します（ワークフロー側で設定済み）:

```bash
BASE_PATH=/openscq30-web/ npm run build
```

> ユーザーページ（`https://<user>.github.io/` 直下）や独自ドメインのルートに置く場合は
> `BASE_PATH` 不要です。

## 2. Cloudflare Pages

1. https://dash.cloudflare.com/ → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. リポジトリを選択し、ビルド設定

   | 項目 | 値 |
   | --- | --- |
   | Framework preset | **Vite** |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Node version | 環境変数 `NODE_VERSION` = `20`（または `22`） |

3. **Save and Deploy** → `https://<project>.pages.dev`

push ごとに自動ビルド、PR ごとのプレビュー URL も発行されます。

## 3. Netlify

1. https://app.netlify.com/ → **Add new site** → **Import an existing project**
2. ビルド設定

   | 項目 | 値 |
   | --- | --- |
   | Build command | `npm run build` |
   | Publish directory | `dist` |
   | Node version | 環境変数 `NODE_VERSION` = `20` |

3. **Deploy site** → `https://<site>.netlify.app`

`netlify.toml` を置きたい場合:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## 4. Vercel

1. https://vercel.com/new でリポジトリをインポート（Framework は **Vite** を自動検出）
2. Build Command `npm run build` / Output Directory `dist`
3. Node 20 を使う場合は **Settings → General → Node.js Version** を 20.x に

`https://<project>.vercel.app` で公開されます。

## 5. 自前サーバー（nginx など）

`dist/` をコピーして配信するだけです。

```nginx
server {
    listen 443 ssl http2;
    server_name openscq30.example.com;

    # Web Serial は HTTPS 必須。証明書は certbot 等で
    ssl_certificate     /etc/letsencrypt/live/openscq30.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/openscq30.example.com/privkey.pem;

    root /var/www/openscq30-web/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 任意:  assets は長期キャッシュ、index.html はキャッシュしない
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

更新は `npm run build` して `dist/` を差し替えるだけ（`rsync -a --delete dist/ server:/var/www/openscq30-web/dist/`）。

## 6. Docker で配信したい場合

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

```bash
docker build -t openscq30-web .
docker run -p 8080:80 openscq30-web
```

> コンテナ内の `http://localhost:8080` は secure context なので、**同じマシン**の Chrome からは
> Web Serial が使えます。別マシンから `http://` でアクセスすると実機接続はできません
> （TLS 终结を前段に入れるか HTTPS で配信してください）。

---

## ホスティング先を選ぶときの注意

| 論点 | 内容 |
| --- | --- |
| HTTPS | 必須。Let's Encrypt などが自動で付くサービスなら問題なし |
| サブパス配信 | GitHub Pages のプロジェクトサイトなど。`BASE_PATH` を指定してビルド |
| iframe 埋め込み | Web Serial は Permissions Policy 対象。埋め込み側で `allow="serial"` が必要 |
| サービスワーカー | 未使用。オフライン対応したければ PWA 化（workbox 等）を別途追加 |
| 認証 | 不要。ユーザーデータはブラウザ内（localStorage）にしか保存されません |
| CORS / バックエンド | 不要。外部への通信は一切行いません |

## 動作確認 checklist（どのホスティング先でも共通）

1. ページを開き、DevTools Console に `navigator.serial` があること
   （`undefined` ならブラウザ未対応か非セキュアコンテキスト）
2. 「デモ機器で試す」で設定画面が出ること（実機不要の動作確認）
3. OS でペアリング → 「イヤホンに接続する」→ 選択ダイアログに Soundcore が出ること
4. 接続後、バッテリー残量・シリアル番号・ファームウェアが表示されること
5. EQ プリセットを変えて「通信ログ」に `02 83` の送信が出ること

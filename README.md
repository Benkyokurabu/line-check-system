# LINE Check System

学習塾のLINE公式アカウントに届いたメッセージをWebhookで受け取り、Supabaseに保存するためのMVPです。

このステップでは、Next.js + TypeScript + App Routerの土台、Supabaseに作成するDBテーブル定義、LINE Webhookで受信メッセージを保存するAPIを用意しています。AI判定、管理画面、ログイン、未対応チェック機能はまだ実装していません。

## Stack

- Next.js App Router
- TypeScript
- Supabase
- Vercel

## Getting Started

依存関係をインストールします。

```bash
npm install
```

`.env.example`を参考に`.env.local`を作成します。秘密情報はコードへ直書きしないでください。

```bash
cp .env.example .env.local
```

開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

## Environment Variables

今後設定する環境変数は以下です。

- `SUPABASE_URL`: Supabase の Project URL を入れる。
- `SUPABASE_SECRET_KEY`: Supabase の Secret key または service_role key を入れる。
- `LINE_CHANNEL_SECRET`: LINE Messaging API の Channel Secret
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging API の Channel Access Token
- `AI_API_KEY`: AI判定を追加するときに使うAPIキー

`SUPABASE_SECRET_KEY` はサーバー側専用で、絶対にブラウザ側コードで使わないでください。

`.env.local` は Git にコミットしません。Vercelでは Project Settings の Environment Variables に同じ値を設定します。

## Supabase Schema

Supabaseにテーブルを作成する手順です。

1. Supabase Dashboard の SQL Editor を開く。
2. `supabase/schema.sql` の内容をコピーして実行する。
3. `line_messages` と `line_tasks` が作成されたことを確認する。

今回はRLSを有効化していません。まずはサーバー側のWebhook APIから `SUPABASE_SECRET_KEY` で書き込む前提です。

## Project Structure

- `src/app`: App Routerの画面とAPIルート
- `src/app/api/line/webhook`: `POST /api/line/webhook` でLINE Webhookを受け取るAPIルート
- `src/lib/env.ts`: サーバー側環境変数の読み込み
- `src/lib/supabase.ts`: Supabase server client の初期化
- `supabase/schema.sql`: SupabaseのDBテーブル定義

## Notes

- APIキーや秘密情報はコードへ直書きしないでください。
- Webhookは `src/app/api/line/webhook/route.ts` に実装済みです。LINE Developers の Webhook URL には `/api/line/webhook` を指定してください。

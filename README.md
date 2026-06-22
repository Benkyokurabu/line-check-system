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
- `GROQ_API_KEY`: Groq APIでAI判定・通知先推定を行う場合のAPIキー
- `TEAMS_WEBHOOK_URL`: Teams Workflows Webhookで通知を送る場合のURL
- `INTERNAL_API_TOKEN`: AI判定やTeams通知APIを手動実行・Cron実行するときの認証トークン

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

## Notification Routing Design

先生ログインを前提にせず、LINE本文と直近の会話履歴から「どの先生が見るべき可能性があるか」をAIで広めに判定し、Teamsなどへ通知する設計です。

- `app_settings`: AIモデル、通知しきい値、会話履歴の参照範囲、定刻通知時刻などの調整値
- `teachers`: 通知対象の先生名、表記ゆれ、通知ON/OFF、先生ごとのしきい値
- `ai_message_routes`: AIが「誰宛か」を判定した結果、信頼度、理由、使用モデル
- `teacher_notifications`: 誰に、いつ、どの方法で通知したかの履歴
- `line_tasks`: 要対応の状態。通知判定とは分離して管理する

通知が多すぎる場合は `app_settings` や `teachers` のしきい値を上げ、拾えていない場合は先生の `aliases` や会話履歴の参照範囲を調整します。

内部APIは `x-internal-token` ヘッダーに `INTERNAL_API_TOKEN` を付けて実行します。

- `POST /api/ai/route-messages`: 未判定のLINEメッセージをAIで判定し、`ai_message_routes` と `teacher_notifications` に保存する
- `POST /api/notifications/teams/send`: `teacher_notifications` の未送信Teams通知を送信し、成功/失敗を保存する

例:

```bash
curl -X POST https://example.vercel.app/api/ai/route-messages \
  -H "content-type: application/json" \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -d '{"limit":10}'
```

## Notes

- APIキーや秘密情報はコードへ直書きしないでください。
- Webhookは `src/app/api/line/webhook/route.ts` に実装済みです。LINE Developers の Webhook URL には `/api/line/webhook` を指定してください。

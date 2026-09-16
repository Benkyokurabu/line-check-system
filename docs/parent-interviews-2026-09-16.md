# 保護者の面談予約

## 画面と操作

- `/interviews`：LINEログイン後、登録済みのお子さまについて公開日程を第1〜第3希望まで選択。第1希望は必須、第2・第3希望は任意。順序変更・取り消し・確認から戻る操作で入力を保持する。
- `/staff/interviews`：申請・確定予定・受付日程の3表示。先生が希望の1枠を承認すると実予約を作成し、既存のNotion予定同期を実行する。
- `/staff/interviews/manage`：従来の詳細管理・面談記録・変更取消。新規面談はオンライン固定。既存の対面予約の履歴は保持する。
- 公開日程は、先生がNotionの担当者1人・45分の予約可から明示的に追加する。2日後〜60日先が対象。
- 申請時に3枠を占有しない。複数の申請が同じ日程を希望でき、承認時に1枠のみ確保する。既に確保された枠は他の申請から承認できない。
- 先生の状況は共有DBへ保存し、表示中は30秒ごとと画面復帰時に更新する。保護者には状況更新ボタンがある。
- LINE通知の自動送信は本変更に含めない。予約状況・再選択理由は予約画面に表示する。

## 保存・認証

`supabase/interview_requests_20260916.sql` は公開枠・保護者申請・親セッション・操作履歴の4テーブルを追加する。承認は既存の `interview_save` による作成と確定を同一トランザクションで実行し、その後Notionに同期する。既存予約は移行・削除しない。

LINE Loginはstate、nonce、PKCEを使用し、IDトークンをLINEの検証APIで確認する。ブラウザには12時間のHttpOnly/Secureセッションだけを保持し、DBにはランダムトークンのハッシュを保存する。氏名や学籍番号の自己申告で他の生徒を紐づけない。

`student_line_accounts` の確認済み関係（mother / father / guardian / shared / student）と在塾台帳を照合する。未確認の関係には日程・申請を公開しない。申請時・再送時・先生の承認時にも関係を再確認する。

## 利用開始前の外部設定

本コードだけではLINE Loginチャネルは作成されない。LINE Loginの設定がない間、保護者画面は受付準備中になり、個人情報を表示しない。

1. [LINE Developersコンソール](https://developers.line.biz/console/)で、現在の公式アカウントのMessaging APIチャネルと**同じプロバイダー**を開く。
2. 既存のLINE Loginチャネルを確認し、なければ「チャネル新規作成」→「LINEログイン」→「ウェブアプリ」を選択する。公開に必要な塾の情報・連絡先を登録する。
3. 「LINEログイン設定」→「コールバックURL」に `https://line-check-system.vercel.app/api/parent/line/callback` を保存する。
4. Vercelの対象プロジェクト→Settings→Environment VariablesのProductionへ `LINE_LOGIN_CHANNEL_ID` と `LINE_LOGIN_CHANNEL_SECRET` を設定し、再デプロイする。秘密値はチャットや公開ファイルへ書かない。既存の `STAFF_AUTH_ORIGIN` と `SUPABASE_SECRET_KEY` も使用する。
5. チャネルを一般利用できる状態にし、実際の保護者LINEアカウントでログインする。確認済みの親子関係と同じ生徒だけが表示されることを確認する。全保護者への配布前に未確認の紐づけを根拠に基づいて確認する。
6. 先生側の「受付日程」→「Notionの予約可から日程を追加」→対象日の「公開する」→確認を保存する。公開する実日程は先生が選ぶ。

保護者入口は `https://line-check-system.vercel.app/interviews`。設定未完了の状態では配布しない。

公式仕様：[ウェブアプリへの組み込み](https://developers.line.biz/en/docs/line-login/integrate-line-login/)、[PKCE](https://developers.line.biz/en/docs/line-login/integrate-pkce/)。

## 検証

- 面談関連の単体・DBテスト64件が成功。申請順序、二重申請、再送、紐づけ失効、競合、承認・確定、未選択枠の再利用、権限を確認した。
- 関連画面32ケースを確認後、最終変更を含め保護者・先生の6ケースを再実行して正常終了。390pxで横はみ出しなし、終了操作後の個人情報消去も確認した。
- 型チェック・対象lint・本番ビルド成功。ローカルの複数lockfileに起因する既存ビルド警告あり。
- DB追加はバックアップ後にdry-run・rollbackを確認し、適用した。実保護者セッション・申請・公開枠は作成していない。
- LINE Loginの実チャネル未設定のため、実アカウントの認可から申請・承認する一連の本番試験は未実施。LINEアプリ実機での最終確認も残る。

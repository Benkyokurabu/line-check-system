# 工藤・金城のパスワード不要入口

ユーザー依頼により、KUDO/KINJOだけにランダム256bitの専用入口を追加。氏名・staffクエリだけではログインできない。個人LINEリッチメニューのURLフラグメントからキーを受け取り、即時にURLから除去して同一オリジンPOSTで照合する。これは専用リンク所持による認証であり、LINE Loginによる本人認証ではない。リンクは認証情報として扱い、転送・ログ出力・Git登録しない。

DBにはSHA256ハッシュのみ保存。キーは180日で期限切れ、有効キーの認証は毎分10回に制限。職員無効化・キー停止・期限切れでは拒否する。Supabaseのメール送信なしのgenerateLink/verifyOtpで通常の管理対象セッションを発行し、既存の職員権限・失効・ログアウト・有効時間を適用する。

`scripts/configure-staff-entry.mjs --env <local-env>` はDBバックアップ後にDDLをロールバック検証。`--apply`で二人のキーを登録する。平文キーはGit対象外の `analysis_outputs/staff-entry-20260916/entry-private.json` に保管。既存キーとローカル記録が一致しなければ上書きせず停止する。更新・再発行時は新キーのハッシュと二人の個別メニューを対応させ、古いキーを停止する。

個別メニューの「面談予約」は `/staff/interviews`、「自習室予約」は既存 `/self-study-room/trial` へ。共通メニューは変更しない。一般向け公開・LINEメッセージ・メール送信なし。

本番の初回スマホ確認で、Service Workerのcontrollerchangeによる自動再読み込みがキー消去後の認証を中断する問題を検出。PwaRegistrationのreloadOnceは専用入口パスでは再読み込みを行わない。localhostで認証応答を待たせてcontrollerchangeを発火する回帰試験を追加し、新入口ブラウザ4件・再ビルド成功。

検証: 職員関連52件成功、面談ブラウザ9件成功、新入口ブラウザ3件成功、変更箇所lint・型検査・本番ビルド成功。通常.nextはOneDriveのEPERMのため既存のBENTAN_ISOLATED_BUILD=true設定でビルド。ブラウザ試験はWindowsのサーバー終了待ちを手動停止。実Supabaseで二人の認証・権限照合・試験セッションのログアウトを確認。

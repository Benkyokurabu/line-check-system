# 知識受信のWindows常駐

`scripts/knowledge-watch-service.ps1` が既存の知識取込CLIをPowerShell 7から非表示で起動・監視する。対象は明示した `-Root` の受信フォルダだけ。本文を新たな外部サービスへ送らない。

```powershell
./scripts/knowledge-watch-service.ps1 -Action Start -Root "C:/Users/kudok/OneDrive/デスクトップ/勉たん"
./scripts/knowledge-watch-service.ps1 -Action Status -Root "C:/Users/kudok/OneDrive/デスクトップ/勉たん"
./scripts/knowledge-watch-service.ps1 -Action Install -Root "C:/Users/kudok/OneDrive/デスクトップ/勉たん"
```

`Start` は現在のログイン中にhidden起動。`Install` は現在のユーザーのログイン時だけ動く専用タスクを登録する。TaskSchedulerへの登録には実行環境の権限承認が必要な場合がある。登録できたことと現在動いていることは別に `Status` で確認する。CLIの既定パスはこのスクリプトと同じフォルダの `knowledge-intake.mjs`。別の配置は `-CliPath` で指定できる。

既存タスクを上書きせず、専用タスク名は監視ルートのハッシュを含む。同名タスクが異なる設定の場合は停止する。タスク側の多重実行抑止、Named Mutex、ランナー存続中のファイル排他保持で二重監視を防ぐ。ユーザーの既存Startup・既存タスク・LINE設定は変更しない。

状態とログは私的な `資料集約/知識基盤/runtime/` に保存する。ログには本文・ファイル名・エラー原文を出さず、日時・件数・プロセス開始終了だけを記録する。既定は1MiBでローテーションし、過去5本まで保持する。`-MaxLogBytes` / `-LogCopies` はRun時の運用調整に使える。

子プロセスが終了すると15秒後に再起動する。知識保存の残存 `.intake.lock` / `.write.lock` は自動削除しない。異常終了後は実際の保存中プロセスの有無とバックアップを確認して復旧する。PC停止中・ログアウト中の取得は行わず、次回ログインで残っている受信ファイルを処理する。アプリ画面・Notion・LINEの全件自動監視を意味しない。

## 2026年10月22日の運用確認

親の勉たんフォルダを対象にhidden監視を開始し、ランナーとNodeの生存、30秒ごとのheartbeat、再Startによる同一PID維持を確認した。環境の正式な権限承認を受け、専用タスク `BentanKnowledgeWatch-71224902565817B8` を登録済み。ログイン時起動・Limited権限・IgnoreNew・実行時間制限なし・hidden引数を読み返した。現在の手動hidden起動と、次回ログインでのタスク起動は区別して確認する。

`scripts/knowledge-watch-service-smoke.ps1` は原資料を使わず一時フォルダで実動作を検査する。hidden起動・実取込・二重起動防止・本文のログ非出力・ログrotationの5項目が成功した。テストで起動したプロセスだけを終了し、一時フォルダは解決後のパスとマーカーを照合して削除する。

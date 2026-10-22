# 見学打合せ後の一括入力：2026年10月22日の到達点

`4b9ed86`（専用画面・反映処理）と `ad595d6`（学年候補の数字表記）をmainへpushし、Vercel成功・本番app-version一致を確認した。工藤先生限定・本番運用前。正式運用の開始や実案件での試用済みを意味しない。

ホーム・サイドメニューの「本番運用前」→「見学打合せ後の一括入力」、URL `/staff/visit-followup`、API `/api/staff/visit-followup`。面談DB・生徒情報・受付DB・終業MTGへ確定した項目を反映し、OneDriveの対保護者業務記録も任意で同じ案件から記入できる。[操作と項目の説明](visit-followup.html)。

受付と面談記録を明示選択し、生徒の状態と独立した受付側の状態を別々に反映する。未確認の候補や予定を実績へ自動確定しない。既存の本文・添付・受付備考のリンクを保持する。受付簿の記入・印刷、教材配布、Zoom・LINE登録の実作業は実施確認と区別する。この画面からLINE送信はしない。

既存の `post_interview_entries` / events / RPC / cronを、`workflow=visit-followup` として使用する。DB migration・権限拡張・cron追加は行っていない。版・操作番号・lease・原本snapshot・処理前の状態保存・来歴リンク照合で、原本競合や応答喪失を扱う。結果不明の新規作成を繰り返さず、反映先別の状態を保持する。ログイン切れでは入力を隠して保持し、同じ職員でのみ復元する。

関連Node56件、関連ブラウザ29件、型・関連lint・本番build成功。専用画面は1280/390px、503時の同一操作番号、409後の原本再確認、保存再開、権限、401後の同じ職員への復元と別職員への非引継ぎを検証した。説明HTMLの3タブと架空の回復例は両画面幅で操作・目視確認してブラウザで開いた。

本番はKUDOで生徒・受付・面談のcontextと職員候補、OneDriveの月別選択肢を読み取った。KINJOは403、未ログインは401。学年候補は原本の選択肢と一致し、確認待ちを維持する。既存の面談後LINEとOneDrive専用画面も表示確認した。業務変更リクエスト0、案件数不変、検証Authセッションは個別signOutし、ブラウザ・試験サーバーを終了した。実生徒への試験記入・案件保存・LINE送信は行っていない。

全体CIは成功とは扱わない。[最終コードのrun](https://github.com/Benkyokurabu/line-check-system/actions/runs/39734406167)はlint・型・全Node・build成功、別jobのPostgreSQL試験成功、ブラウザ355件中330成功・25失敗。[変更前8be4d76のrun](https://github.com/Benkyokurabu/line-check-system/actions/runs/39607305851)も325成功・同じ25失敗。失敗名25件を機械比較して一致を確認した。今回追加の5件はCIでもすべて成功している。既存の失敗には職員セッション・改善要望のモック不足、古いメニュー期待値、旧面談ダイアログ等が含まれ、今回のために既存機能を変えて解消することはしていない。

作業は `output/resume-integrated-20261022` の `feat/visit-followup-20261022`。旧PCフォルダの差分を戻さず、古い親mainをそのままpushしない。私的な原本照合・画面・CIログはignored `analysis_outputs/` に保存し、Gitへ追加しない。

# 他社調査から学んだUIと提案理由

確認日：2026-10-22。公式ヘルプに基づく知見。各社の実機能、勉たんへの提案、ユーザー採用済み方針を区別する。製品仕様に依存する判断は、将来の利用時に再確認する。

| 製品 | 学んだこと | 勉たんへの適用案 |
| --- | --- | --- |
| サイボウズ Office | 明示確認と、宛先の人も見られる確認者・時刻 | 本人・版ごとの確認履歴 |
| LINE WORKS | 既読・未読一覧、必読表示、投稿検索 | 必要な人へ届け、確認後も探せる一覧 |
| kintone | 通知検索・絞り込み・あとで読む | 未確認とすべての切替、後から戻る手段 |
| Teams | 保存したメッセージから元の会話へ戻る | 個人保存と生徒・案件の経緯 |
| Slack | 指定した日時のリマインダー | 忙しい時に後で確認する導線 |
| Notion AI / Wiki | 情報源を絞る検索と引用、文書の責任者・確認期限 | 原文に戻れる回答、取得範囲と文書の鮮度の明示 |

公式資料：[Office閲覧確認](https://jp.cybozu.help/o/ja/user/app/ms/plus/acknowledgment.html)、[LINE WORKS既読](https://help.worksmobile.com/ja/use-guides/board/check-post/check-read-member/)・[検索](https://help.worksmobile.com/ja/use-guides/board/search-note/)、[kintone通知](https://jp.kintone.help/k/ja/notifications/usage/notification_overview)、[Teams保存](https://support.microsoft.com/en-gb/teams/chat/save-a-chat-or-channel-message-in-microsoft-teams)、[Slackリマインダー](https://slack.com/intl/ja-jp/help/articles/208423427-Set-a-reminder)、[Notion検索](https://www.notion.com/help/enterprise-search)・[確認期限](https://www.notion.com/help/wikis-and-verified-pages)。

## 見本の追加機能と理由

| 要素 | 区別と理由 |
| --- | --- |
| 個人保存 | 提案。後から再検索せず開く目印。読了・原文記入・業務完了とは別 |
| 最近確認した連絡・検索 | 提案。「さっき読んだもの」や過去の記録を探しやすくする |
| あとで確認 | 提案。忙しい時に戻るため。期限延長や確認済みにはしない |
| 担当期限・対応完了 | 提案。読了だけで必要な対応まで終わった扱いにしない |
| 改訂して再確認を試す | 架空データの動作確認。新版の表示を試すもので、実原本編集ではない |
| 再通知を試す | 架空データの動作確認。未確認者への再通知案を示す。実送信なし |

追加理由があることを採用済みとは扱わない。ユーザーが指定した、小さな行・左の選択チェック・同位置展開・確認後に明示削除という操作は維持する。[操作見本](benkei-sharing-design-20261022.html)は架空データのみで、全ての提案が本番実装済みという意味ではない。

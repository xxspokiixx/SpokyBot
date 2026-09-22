# Issue #1688 — 設計

## 変更

`STATIC_CLAUDE_MODELS` に `{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }` を `claude-opus-5` の直前へ足す。`default` は変えない。

`resolveClaudeTurnModel` は静的一覧にある id をローカル注入の探索から外す。新しい id がその一覧に入るので、追加の分岐は要らない。

`modelContextWindow` は `claude-opus-5-5` だけ 1,000,000 を返す。判定は `claude-opus-5` に前方一致しない形にする。

## 影響範囲

| 対象 | 箇所 | 種別 | 方針 |
| --- | --- | --- | --- |
| Claude の静的一覧 | `server/drivers/claude.ts` `STATIC_CLAUDE_MODELS` | 機能 | 1 行追加。既定と既存ボットは不変 |
| コンテキスト幅 | `server/model-context-window.ts` | 機能 | Opus 5.5 だけ 1M |
| Droid の `MODELS` | `server/drivers/acp/droid.ts` | なし | Factory 側のスナップショットなので触らない |
| カタログ検査 | `claude-catalog.test.ts` | テスト | 位置と既定を固定 |
| 幅の検査 | `model-context-window.test.ts` | テスト | 5.5 は 1M、5 は 200k |

呼び出し側は一覧をそのままピッカーに出す。並びの契約は変えない。

## テスト

隔離した vitest で上記 2 ファイルを実行する。変異は静的一覧から `claude-opus-5-5` を外し、カタログ検査が落ちることを見る。確認後に戻す。

# Issue #1688 — Claude Opus 5.5 を選べるようにする

## 目的

2026-09-22 に出た Claude Opus 5.5（API id `claude-opus-5-5`、コンテキスト 100 万トークン）を、Claude エンジンのモデル一覧に出す。

## 受け入れ

- 一覧は `claude-opus-5` の直前に `claude-opus-5-5` / "Claude Opus 5.5" を置く。
- 既定は `claude-sonnet-5` のまま。既存ボットのモデルは書き換えない。
- `modelContextWindow("claude-opus-5-5")` は 1,000,000。`claude-opus-5` は `[1m]` が付かない限り 200,000。
- この id は公式クラウドモデルとして扱い、ローカル注入の探索をしない。
- Droid の固定一覧は変えない。

## 非スコープ

- 既定モデルの変更、ボットの移行、Fast mode、Bedrock の別 id。
- `thinking` の無効化や強制 `tool_choice`。Claude ドライバはそれらを送っていない。

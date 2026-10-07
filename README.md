# paseo-cmd-acp

[Paseo](https://github.com/getpaseo/paseo) から [Command Code](https://commandcode.ai/) (`cmd`) を使うための ACP 互換アダプタです。

Paseo の汎用 ACP プロバイダ (`extends: "acp"`) と `cmd acp` の間に入り、stdio 上の JSON-RPC (NDJSON) を中継しながら、両者の解釈の差を埋めます。認証・モデル・ツール・MCP・推論はすべて Command Code 本体が処理します。

```text
Paseo (ACP クライアント / @agentclientprotocol/sdk 0.17)
  -> paseo-cmd-acp (互換レイヤー)
  -> cmd acp (ACP エージェント。Windows では cmdc acp)
```

## 互換レイヤーが行うこと

| 問題 | 対応 |
|---|---|
| モデルや effort を変えると、Paseo がモード一覧を configOptions から作り直してモードが空になり、以降モード切り替えが失敗する | configOptions に `mode` カテゴリの選択肢を補う |
| `session/prompt` の `usage` がセッション累積値で、Paseo がそれをターン使用量として表示する | `_meta.usage` のターン使用量に置き換える |
| 編集ツールの完了通知で diff が結果テキストに置き換わり、Paseo で差分が消える | 最初の diff を保持し、結果テキストを取り除く |
| ツール失敗時のエラーが content にしか無く、Paseo では "Tool call failed" と表示される | エラーテキストを `rawOutput.message` に複写する |
| シェル結果の終了コードが出力先頭の `Exit code: N` 行にしか無い | `rawOutput.exitCode` に移す |
| ACP には system prompt を渡す経路が無く、Paseo で設定した systemPrompt / daemon の appendSystemPrompt が届かない | 新規セッションの最初のプロンプトの先頭に注入し、履歴の再生時には取り除く |
| アダプタ側で起動に失敗・異常終了すると、Paseo が `initialize` 等の応答を待ち続けて固まる | 応答待ちの要求すべてに JSON-RPC エラーを返す |

## 必要なもの

- Node.js 22 以上
- Command Code (`npm i -g command-code`) と `cmd login` (Windows では `cmdc login`) 済みのアカウント
- Paseo

## Paseo の設定

`~/.paseo/config.json` (または `$PASEO_HOME/config.json`) にプロバイダを追加し、Paseo のデーモンを再起動します。

```json
{
  "agents": {
    "providers": {
      "cmd": {
        "extends": "acp",
        "label": "Command Code",
        "command": ["npx", "-y", "github:mohemohe/paseo-cmd-acp"]
      }
    }
  }
}
```

ローカルに clone したものを使う場合は `"command": ["node", "/path/to/paseo-cmd-acp/dist/main.js"]` を指定します。

### 環境変数

| 変数 | 内容 |
|---|---|
| `PASEO_CMD_ACP_BIN` | 起動する Command Code の実行ファイル。既定はネイティブ Windows で [`cmdc`](https://commandcode.ai/docs/windows#on-native-windows)、それ以外で `cmd` |

Paseo の設定でプロバイダの `env` に指定できます。

## モード

モードは Command Code が返すものをそのまま使います。

| id | 内容 |
|---|---|
| `default` | 変更を伴うツールの実行前に確認する |
| `auto-accept` | ファイル編集は自動承認し、危険な操作は確認する |
| `plan` | 調査と計画のみ (編集・コマンド実行なし) |
| `dont-ask` | 確認なしで実行する (安全装置は維持) |
| `bypass` | すべての権限確認を省略する |

Paseo の Auto Accept を有効にした場合は、Paseo 側が権限確認に自動で応答します。

## 開発

```bash
npm install
npm test        # 型チェックとユニットテスト
npm run build   # dist/ を生成
```

`npx github:...` でのインストール時にビルドが走らないよう、`dist/` はリポジトリにコミットしています。`npm install` で [lefthook](https://lefthook.dev/) の pre-commit フックが入り、`src/` などを含むコミットでは自動でビルドして `dist/` をコミットに含めます。ビルドは作業ツリーの内容から行うため、一部だけステージしたコミットでは未ステージの変更も `dist/` に反映される点に注意してください。

## ライセンス

MIT

# paseo-cmd-acp

[日本語](README.ja.md)

An ACP compatibility adapter for using [Command Code](https://commandcode.ai/) (`cmd`) from [Paseo](https://github.com/getpaseo/paseo).

It sits between Paseo's generic ACP provider (`extends: "acp"`) and `cmd acp`, relaying JSON-RPC (NDJSON) over stdio while bridging the differences in how the two sides interpret the protocol. Authentication, models, tools, MCP, and inference are all handled by Command Code itself.

```text
Paseo (ACP client / @agentclientprotocol/sdk 0.17)
  -> paseo-cmd-acp (compatibility layer)
  -> cmd acp (ACP agent; cmdc acp on Windows)
```

## What the compatibility layer does

| Problem | Fix |
|---|---|
| When the model or effort is changed, Paseo rebuilds the mode list from configOptions, the modes become empty, and subsequent mode switches fail | Supplies `mode` category options in configOptions |
| `usage` in `session/prompt` is the cumulative session value, and Paseo displays it as per-turn usage | Replaces it with the per-turn usage from `_meta.usage` |
| On edit tool completion notifications, the diff is replaced by the result text and the diff disappears in Paseo | Keeps the first diff and removes the result text |
| On tool failure, the error exists only in content, so Paseo shows "Tool call failed" | Copies the error text into `rawOutput.message` |
| The exit code of shell results exists only as an `Exit code: N` line at the top of the output | Moves it to `rawOutput.exitCode` |
| ACP has no way to pass a system prompt, so the systemPrompt configured in Paseo and the daemon's appendSystemPrompt never arrive | Injects it at the beginning of the first prompt of a new session, and strips it when replaying history |
| If the adapter fails to start or exits abnormally, Paseo hangs waiting for responses to `initialize` and other requests | Returns a JSON-RPC error for every pending request |

## Requirements

- Node.js 22 or later
- Command Code (`npm i -g command-code`) and an account logged in with `cmd login` (`cmdc login` on Windows)
- Paseo

## Paseo configuration

Add a provider to `~/.paseo/config.json` (or `$PASEO_HOME/config.json`) and restart the Paseo daemon.

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

To use a local clone, specify `"command": ["node", "/path/to/paseo-cmd-acp/dist/main.js"]`.

### Environment variables

| Variable | Description |
|---|---|
| `PASEO_CMD_ACP_BIN` | The Command Code executable to launch. Defaults to [`cmdc`](https://commandcode.ai/docs/windows#on-native-windows) on native Windows and `cmd` elsewhere |
| `CMD_ZDR` | Set to `1` to enable [Zero Data Retention](https://commandcode.ai/docs/resources/zdr). Read directly by Command Code itself |

These can be set in the provider's `env` in the Paseo configuration.

### Zero Data Retention (ZDR)

Command Code's ZDR can only be toggled by the `CMD_ZDR` environment variable at startup; there is no way to change it during a session via ACP. Also, since Paseo launches the adapter per session, define two providers that differ only in `env` and choose ZDR on or off by selecting the provider when creating a session. It cannot be switched for an already created session.

```json
{
  "agents": {
    "providers": {
      "cmd": {
        "extends": "acp",
        "label": "Command Code",
        "command": ["npx", "-y", "github:mohemohe/paseo-cmd-acp"]
      },
      "cmd-zdr": {
        "extends": "acp",
        "label": "Command Code (ZDR)",
        "command": ["npx", "-y", "github:mohemohe/paseo-cmd-acp"],
        "env": { "CMD_ZDR": "1" }
      }
    }
  }
}
```

Requests fail for models with no ZDR-compatible upstream (`422 cmd_zdr_no_providers`). Pricing may be higher than usual.

## Modes

Modes are used as returned by Command Code.

| id | Description |
|---|---|
| `default` | Asks for confirmation before running tools that make changes |
| `auto-accept` | Automatically approves file edits, asks for confirmation on dangerous operations |
| `plan` | Investigation and planning only (no edits or command execution) |
| `dont-ask` | Runs without confirmation (safeguards remain in place) |
| `bypass` | Skips all permission checks |

When Paseo's Auto Accept is enabled, Paseo automatically responds to permission requests.

## Development

```bash
npm install
npm test        # type check and unit tests
npm run build   # generate dist/
```

`dist/` is committed to the repository so that no build runs when installing via `npx github:...`. `npm install` installs a [lefthook](https://lefthook.dev/) pre-commit hook that automatically builds and includes `dist/` in commits that touch `src/` and similar paths. Note that the build uses the working tree contents, so for partially staged commits, unstaged changes are also reflected in `dist/`.

## License

MIT

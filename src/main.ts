#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readPaseoSystemContext } from "./compat/paseo-context.js";
import { isRecord, isRequest, LineDecoder } from "./json-rpc.js";
import { AcpCompatProxy, errorResponse } from "./proxy.js";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

// ネイティブ Windows では `cmd` が cmd.exe に取られるため、Command Code は `cmdc` を使う
// https://commandcode.ai/docs/windows#on-native-windows
function defaultBin(platform: NodeJS.Platform): string {
  return platform === "win32" ? "cmdc" : "cmd";
}

function main(): void {
  const bin = process.env.PASEO_CMD_ACP_BIN?.trim() || defaultBin(process.platform);
  const child = spawn(bin, ["acp"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
    shell: process.platform === "win32",
  });

  const proxy = new AcpCompatProxy({
    loadSystemContext: () => readPaseoSystemContext(process.env),
  });

  const writeLine = (line: string) => process.stdout.write(`${line}\n`);
  const exit = (code: number) => process.stdout.write("", () => process.exit(code));

  // エージェントが使えなくなった理由。設定後に届いた要求にはこのエラーを返す。
  let agentFailure: string | null = null;
  const failAgent = (reason: string) => {
    agentFailure ??= reason;
    process.stderr.write(`[paseo-cmd-acp] ${reason}\n`);
    for (const line of proxy.failPendingRequests(agentFailure)) writeLine(line);
  };

  let spawnFailed = false;
  child.once("error", (error) => {
    // 起動に失敗しても即終了せず、Paseo の initialize などにエラーを返してから stdin の終了を待つ
    spawnFailed = true;
    failAgent(`failed to start '${bin} acp': ${error.message}. Install Command Code or set PASEO_CMD_ACP_BIN.`);
  });
  // stdout を流し切ってから終了するため exit ではなく close を待つ
  child.once("close", (code, signal) => {
    if (spawnFailed) return;
    failAgent(`'${bin} acp' exited (${signal ?? `code ${code}`})`);
    exit(code ?? 1);
  });
  child.stdin.on("error", () => {
    // エージェント終了後の書き込み失敗 (EPIPE) は close 側で扱う
  });
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      if (spawnFailed) process.exit(1);
      child.kill(signal);
    });
  }

  // Paseo → エージェント。注入処理が非同期でも順序を保つため直列に書き込む。
  const clientDecoder = new LineDecoder();
  let clientQueue = Promise.resolve();
  const forwardToAgent = (line: string) => {
    if (agentFailure) {
      replyFailure(line, agentFailure, writeLine);
      return;
    }
    clientQueue = clientQueue
      .then(() => proxy.fromClient(line))
      .catch(() => line)
      .then((out) => {
        if (agentFailure) {
          replyFailure(line, agentFailure, writeLine);
        } else if (child.stdin.writable) {
          child.stdin.write(`${out}\n`);
        }
      });
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const line of clientDecoder.feed(chunk)) forwardToAgent(line);
  });
  process.stdin.once("end", () => {
    const rest = clientDecoder.flush();
    if (rest) forwardToAgent(rest);
    if (spawnFailed) {
      exit(1);
      return;
    }
    void clientQueue.then(() => child.stdin.end());
  });

  // エージェント → Paseo
  const agentDecoder = new LineDecoder();
  const writeToClient = (line: string) => {
    let out = line;
    try {
      out = proxy.fromAgent(line);
    } catch {
      // 書き換えに失敗しても元のメッセージは必ず届ける
    }
    writeLine(out);
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    for (const line of agentDecoder.feed(chunk)) writeToClient(line);
  });
  child.stdout.once("end", () => {
    const rest = agentDecoder.flush();
    if (rest) writeToClient(rest);
  });
}

function replyFailure(line: string, reason: string, writeLine: (line: string) => void): void {
  try {
    const message: unknown = JSON.parse(line);
    if (isRecord(message) && isRequest(message)) {
      writeLine(errorResponse((message.id as string | number | null) ?? null, reason));
    }
  } catch {
    // 解析できない行には応答しない
  }
}

main();

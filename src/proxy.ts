import { ModeCompat } from "./compat/modes.js";
import { prependContext, stripContextFromUserChunk } from "./compat/paseo-context.js";
import { ToolCallCompat } from "./compat/tool-calls.js";
import { rewritePromptUsage } from "./compat/usage.js";
import {
  idKey,
  isJsonRpcMessage,
  isNotification,
  isRecord,
  isRequest,
  isResponse,
  type JsonRpcId,
  type JsonRpcMessage,
} from "./json-rpc.js";

export type ProxyOptions = {
  /** Paseo のシステムコンテキストを読み出す。空文字なら注入しない。 */
  loadSystemContext: () => Promise<string>;
};

type PendingRequest = {
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
};

/**
 * Paseo (ACP クライアント) と `command-code acp` (ACP エージェント) の間に入り、
 * 1 行 1 メッセージの JSON-RPC を必要な箇所だけ書き換えて中継する。
 */
export class AcpCompatProxy {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly toolCalls = new ToolCallCompat();
  private readonly modes = new ModeCompat();
  /** session/new で作られ、まだ最初のプロンプトを送っていないセッション */
  private readonly freshSessions = new Set<string>();
  private systemContext: Promise<string> | null = null;

  constructor(private readonly options: ProxyOptions) {}

  /** Paseo → エージェント。プロンプトへのコンテキスト注入があるため非同期。 */
  async fromClient(line: string): Promise<string> {
    const message = parse(line);
    if (!message || !isRequest(message)) {
      return line;
    }
    const method = message.method as string;
    this.pending.set(idKey(message.id), { id: message.id ?? null, method, params: isRecord(message.params) ? message.params : {} });

    if (method === "session/prompt" && isRecord(message.params)) {
      const sessionId = message.params.sessionId;
      if (typeof sessionId === "string" && this.freshSessions.delete(sessionId)) {
        const context = await this.loadSystemContextOnce();
        if (context) {
          return JSON.stringify({ ...message, params: prependContext(message.params, context) });
        }
      }
    }
    return line;
  }

  /**
   * エージェントが応答できなくなったとき、応答待ちの要求すべてに返すエラー応答を作る。
   * Paseo の ACP SDK は接続が切れても応答待ちを reject しないため、返さないと initialize 等で固まる。
   */
  failPendingRequests(reason: string): string[] {
    const lines = [...this.pending.values()].map((request) => errorResponse(request.id, reason));
    this.pending.clear();
    return lines;
  }

  /** エージェント → Paseo */
  fromAgent(line: string): string {
    const message = parse(line);
    if (!message) {
      return line;
    }
    if (isResponse(message)) {
      return this.rewriteResponse(message) ?? line;
    }
    if (isNotification(message) && message.method === "session/update") {
      return this.rewriteSessionUpdate(message) ?? line;
    }
    return line;
  }

  private rewriteResponse(message: JsonRpcMessage): string | null {
    const key = idKey(message.id);
    const request = this.pending.get(key);
    if (!request) {
      return null;
    }
    this.pending.delete(key);
    if (!("result" in message) || !isRecord(message.result)) {
      return null;
    }
    const result = message.result;
    const requestSessionId = typeof request.params.sessionId === "string" ? request.params.sessionId : null;
    switch (request.method) {
      case "session/new": {
        if (typeof result.sessionId !== "string") return null;
        this.freshSessions.add(result.sessionId);
        return this.replaceResult(message, this.modes.applySessionResult(result.sessionId, result));
      }
      case "session/load":
      case "session/resume":
        if (!requestSessionId) return null;
        return this.replaceResult(message, this.modes.applySessionResult(requestSessionId, result));
      case "session/set_mode":
        if (requestSessionId && typeof request.params.modeId === "string") {
          this.modes.setCurrentMode(requestSessionId, request.params.modeId);
        }
        return null;
      case "session/set_config_option":
        if (!requestSessionId || !Array.isArray(result.configOptions)) return null;
        return this.replaceResult(message, {
          ...result,
          configOptions: this.modes.withModeOption(requestSessionId, result.configOptions),
        });
      case "session/prompt":
        return this.replaceResult(message, rewritePromptUsage(result));
      default:
        return null;
    }
  }

  private replaceResult(message: JsonRpcMessage, result: unknown): string | null {
    return result === message.result ? null : JSON.stringify({ ...message, result });
  }

  private rewriteSessionUpdate(message: JsonRpcMessage): string | null {
    const params = message.params;
    if (!isRecord(params) || !isRecord(params.update)) {
      return null;
    }
    const update = params.update;
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    let next: Record<string, unknown>;
    switch (update.sessionUpdate) {
      case "current_mode_update":
        if (typeof update.currentModeId === "string") {
          this.modes.setCurrentMode(sessionId, update.currentModeId);
        }
        return null;
      case "config_option_update":
        if (!Array.isArray(update.configOptions)) return null;
        next = { ...update, configOptions: this.modes.withModeOption(sessionId, update.configOptions) };
        break;
      case "tool_call":
      case "tool_call_update":
        next = this.toolCalls.transform(update);
        break;
      case "user_message_chunk":
        next = stripContextFromUserChunk(update);
        break;
      default:
        return null;
    }
    return next === update ? null : JSON.stringify({ ...message, params: { ...params, update: next } });
  }

  private loadSystemContextOnce(): Promise<string> {
    this.systemContext ??= this.options.loadSystemContext().catch(() => "");
    return this.systemContext;
  }
}

function parse(line: string): JsonRpcMessage | null {
  try {
    const value: unknown = JSON.parse(line);
    return isJsonRpcMessage(value) ? value : null;
  } catch {
    return null;
  }
}

const INTERNAL_ERROR = -32603;

export function errorResponse(id: JsonRpcId, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message } });
}

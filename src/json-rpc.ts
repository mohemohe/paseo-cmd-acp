export type JsonRpcId = string | number | null;

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return isRecord(value);
}

export function isRequest(message: JsonRpcMessage): boolean {
  return typeof message.method === "string" && "id" in message;
}

export function isNotification(message: JsonRpcMessage): boolean {
  return typeof message.method === "string" && !("id" in message);
}

export function isResponse(message: JsonRpcMessage): boolean {
  return typeof message.method !== "string" && ("result" in message || "error" in message);
}

/** JSON-RPC の id は string / number のどちらでも来るので Map のキーを揃える。 */
export function idKey(id: JsonRpcId | undefined): string {
  return `${typeof id}:${String(id)}`;
}

/** NDJSON を行単位に切り出す。末尾の不完全な行はバッファに残す。 */
export class LineDecoder {
  private buffer = "";

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim().length > 0) {
        lines.push(line);
      }
      index = this.buffer.indexOf("\n");
    }
    return lines;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }
}

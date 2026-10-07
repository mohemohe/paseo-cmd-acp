export function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isJsonRpcMessage(value) {
    return isRecord(value);
}
export function isRequest(message) {
    return typeof message.method === "string" && "id" in message;
}
export function isNotification(message) {
    return typeof message.method === "string" && !("id" in message);
}
export function isResponse(message) {
    return typeof message.method !== "string" && ("result" in message || "error" in message);
}
/** JSON-RPC の id は string / number のどちらでも来るので Map のキーを揃える。 */
export function idKey(id) {
    return `${typeof id}:${String(id)}`;
}
/** NDJSON を行単位に切り出す。末尾の不完全な行はバッファに残す。 */
export class LineDecoder {
    buffer = "";
    feed(chunk) {
        this.buffer += chunk;
        const lines = [];
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
    flush() {
        const rest = this.buffer.trim();
        this.buffer = "";
        return rest.length > 0 ? rest : null;
    }
}

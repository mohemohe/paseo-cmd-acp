import { isRecord } from "../json-rpc.js";

function readTokenCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Command Code は session/prompt の `usage` にセッション累積値を入れ、そのターン分を
 * `_meta.usage` に入れる。Paseo は `usage` をターン使用量として扱うため、ターン分に差し替える。
 * `_meta.usage` が無いのはそのターンでトークンを消費しなかった場合 (スラッシュコマンド等) なので 0 にする。
 */
export function rewritePromptUsage(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.usage)) {
    return result;
  }
  const turnUsage = isRecord(result._meta) && isRecord(result._meta.usage) ? result._meta.usage : {};
  const inputTokens = readTokenCount(turnUsage, "inputTokens");
  const outputTokens = readTokenCount(turnUsage, "outputTokens");
  return {
    ...result,
    usage: {
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      cachedReadTokens: readTokenCount(turnUsage, "cacheReadTokens"),
      cachedWriteTokens: readTokenCount(turnUsage, "cacheWriteTokens"),
    },
  };
}

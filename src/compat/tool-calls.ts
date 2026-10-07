import { isRecord } from "../json-rpc.js";

type ToolCallState = {
  kind?: string;
  diffs?: unknown[];
};

const EDIT_KINDS = new Set(["edit", "delete"]);
const EXIT_CODE_LINE = /^Exit code: (-?\d+)(?:\r?\n|$)/;

function isTextContent(item: unknown): item is { type: "content"; content: { type: "text"; text: string } } {
  return (
    isRecord(item) &&
    item.type === "content" &&
    isRecord(item.content) &&
    item.content.type === "text" &&
    typeof item.content.text === "string"
  );
}

function isDiffContent(item: unknown): boolean {
  return isRecord(item) && item.type === "diff";
}

/**
 * Command Code の tool_call / tool_call_update を Paseo のツール表示に合う形へ整える。
 *
 * - 編集系ツールの完了通知は diff を含まない結果テキストで content を置き換えるため、
 *   Paseo 側で diff が消えて結果テキストが unifiedDiff として表示される。最初の diff を維持する。
 * - 失敗時のエラーは content テキストにしか無く、Paseo は rawOutput.message を読むので複写する。
 * - シェル結果の先頭行 `Exit code: N` を rawOutput.exitCode に移す。
 */
export class ToolCallCompat {
  private readonly states = new Map<string, ToolCallState>();

  transform(update: Record<string, unknown>): Record<string, unknown> {
    const toolCallId = update.toolCallId;
    if (typeof toolCallId !== "string") {
      return update;
    }
    const state = this.states.get(toolCallId) ?? {};
    if (typeof update.kind === "string") {
      state.kind = update.kind;
    }

    let next = update;
    const content = Array.isArray(update.content) ? update.content : undefined;
    if (content) {
      const diffs = content.filter(isDiffContent);
      if (diffs.length > 0) {
        state.diffs = diffs;
      }
      const texts = content.filter(isTextContent).map((item) => item.content.text);

      if (update.status === "failed" && texts.length > 0 && update.rawOutput === undefined) {
        next = { ...next, rawOutput: { message: texts.join("\n") } };
      }
      if (state.kind && EDIT_KINDS.has(state.kind) && state.diffs) {
        next = { ...next, content: diffs.length > 0 ? diffs : state.diffs };
      } else if (state.kind === "execute") {
        next = extractExitCode(next, content);
      }
    }

    if (update.status === "completed" || update.status === "failed") {
      this.states.delete(toolCallId);
    } else {
      this.states.set(toolCallId, state);
    }
    return next;
  }
}

function extractExitCode(update: Record<string, unknown>, content: unknown[]): Record<string, unknown> {
  let exitCode: number | undefined;
  const nextContent = content.map((item) => {
    if (exitCode !== undefined || !isTextContent(item)) {
      return item;
    }
    const match = EXIT_CODE_LINE.exec(item.content.text);
    if (!match) {
      return item;
    }
    exitCode = Number(match[1]);
    return { ...item, content: { ...item.content, text: item.content.text.slice(match[0].length) } };
  });
  if (exitCode === undefined) {
    return update;
  }
  const rawOutput = isRecord(update.rawOutput) ? update.rawOutput : {};
  return { ...update, content: nextContent, rawOutput: { ...rawOutput, exitCode } };
}

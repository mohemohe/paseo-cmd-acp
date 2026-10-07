import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PASEO_CONTEXT_OPEN,
  prependContext,
  readPaseoSystemContext,
  stripContextFromUserChunk,
} from "../src/compat/paseo-context.js";
import { ToolCallCompat } from "../src/compat/tool-calls.js";
import { rewritePromptUsage } from "../src/compat/usage.js";

describe("rewritePromptUsage", () => {
  it("replaces cumulative session usage with the turn usage from _meta", () => {
    const result = rewritePromptUsage({
      stopReason: "end_turn",
      usage: { totalTokens: 1000, inputTokens: 900, outputTokens: 100, cachedReadTokens: 50, cachedWriteTokens: 0 },
      _meta: { usage: { inputTokens: 90, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 1 } },
    });
    expect(result).toMatchObject({
      usage: { totalTokens: 100, inputTokens: 90, outputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 1 },
    });
  });

  it("reports zero when the turn consumed no tokens", () => {
    const result = rewritePromptUsage({
      stopReason: "end_turn",
      usage: { totalTokens: 1000, inputTokens: 900, outputTokens: 100, cachedReadTokens: 0, cachedWriteTokens: 0 },
    });
    expect(result).toMatchObject({ usage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 } });
  });

  it("leaves results without usage untouched", () => {
    const result = { stopReason: "cancelled" };
    expect(rewritePromptUsage(result)).toBe(result);
  });
});

describe("ToolCallCompat", () => {
  const diff = { type: "diff", path: "/w/b.txt", oldText: null, newText: "HELLO\n" };
  const text = (value: string) => ({ type: "content", content: { type: "text", text: value } });

  it("keeps the edit diff when the completion only carries result text", () => {
    const compat = new ToolCallCompat();
    compat.transform({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "edit", status: "pending", content: [diff] });
    const done = compat.transform({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [text("File created successfully at: /w/b.txt")],
    });
    expect(done.content).toEqual([diff]);
  });

  it("drops result text from replayed edit tool calls", () => {
    const compat = new ToolCallCompat();
    const replayed = compat.transform({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      kind: "edit",
      status: "completed",
      content: [diff, text("File created successfully")],
    });
    expect(replayed.content).toEqual([diff]);
  });

  it("copies the failure text into rawOutput.message", () => {
    const compat = new ToolCallCompat();
    compat.transform({ sessionUpdate: "tool_call", toolCallId: "t2", kind: "read", status: "pending" });
    const failed = compat.transform({
      sessionUpdate: "tool_call_update",
      toolCallId: "t2",
      status: "failed",
      content: [text("Permission denied by the user.")],
    });
    expect(failed.rawOutput).toEqual({ message: "Permission denied by the user." });
  });

  it("moves the shell exit code line into rawOutput.exitCode", () => {
    const compat = new ToolCallCompat();
    compat.transform({ sessionUpdate: "tool_call", toolCallId: "t3", kind: "execute", status: "pending" });
    const done = compat.transform({
      sessionUpdate: "tool_call_update",
      toolCallId: "t3",
      status: "completed",
      content: [text("Exit code: 1\ncat: x: No such file or directory")],
    });
    expect(done.rawOutput).toEqual({ exitCode: 1 });
    expect(done.content).toEqual([text("cat: x: No such file or directory")]);
  });

  it("returns updates it does not need to change as-is", () => {
    const compat = new ToolCallCompat();
    const update = { sessionUpdate: "tool_call_update", toolCallId: "t4", status: "in_progress" };
    expect(compat.transform(update)).toBe(update);
  });
});

describe("Paseo system context", () => {
  async function createPaseoHome(metadata: Record<string, unknown>): Promise<string> {
    const home = await mkdtemp(path.join(os.tmpdir(), "paseo-cmd-acp-"));
    await mkdir(path.join(home, "agents", "project"), { recursive: true });
    await writeFile(
      path.join(home, "agents", "project", "agent-1.json"),
      JSON.stringify({ id: "agent-1", persistence: { metadata } }),
    );
    return home;
  }

  it("reads the agent system prompt and the daemon append prompt", async () => {
    const home = await createPaseoHome({ systemPrompt: "Reply in Japanese.", daemonAppendSystemPrompt: "Be brief." });
    const context = await readPaseoSystemContext({ PASEO_HOME: home, PASEO_AGENT_ID: "agent-1" });
    expect(context).toBe("Reply in Japanese.\n\nBe brief.");
  });

  it("returns nothing without an agent id", async () => {
    expect(await readPaseoSystemContext({})).toBe("");
  });

  it("round-trips through prompt injection and history replay", () => {
    const params = prependContext({ sessionId: "s", prompt: [{ type: "text", text: "hello" }] }, "Reply in Japanese.");
    const prompt = (params as { prompt: { text: string }[] }).prompt;
    expect(prompt).toHaveLength(2);
    expect(prompt[0].text.startsWith(PASEO_CONTEXT_OPEN)).toBe(true);

    // Command Code joins text blocks with a blank line when it stores the user message
    const stored = `${prompt[0].text}\n\n${prompt[1].text}`;
    const replayed = stripContextFromUserChunk({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: stored },
    });
    expect(replayed.content).toEqual({ type: "text", text: "hello" });
  });
});

import { describe, expect, it } from "vitest";
import { PASEO_CONTEXT_OPEN } from "../src/compat/paseo-context.js";
import { AcpCompatProxy } from "../src/proxy.js";

function createProxy(context = "Reply in Japanese.") {
  let loads = 0;
  const proxy = new AcpCompatProxy({
    loadSystemContext: async () => {
      loads += 1;
      return context;
    },
  });
  return { proxy, loads: () => loads };
}

const line = (value: unknown) => JSON.stringify(value);

async function openSession(proxy: AcpCompatProxy, sessionId: string, requestId: number) {
  await proxy.fromClient(line({ jsonrpc: "2.0", id: requestId, method: "session/new", params: { cwd: "/w", mcpServers: [] } }));
  proxy.fromAgent(line({ jsonrpc: "2.0", id: requestId, result: { sessionId } }));
}

function prompt(id: number | string, sessionId: string) {
  return line({ jsonrpc: "2.0", id, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: "hi" }] } });
}

describe("AcpCompatProxy", () => {
  it("injects the Paseo context only into the first prompt of a new session", async () => {
    const { proxy, loads } = createProxy();
    await openSession(proxy, "s1", 1);

    const first = JSON.parse(await proxy.fromClient(prompt(2, "s1")));
    expect(first.params.prompt[0].text.startsWith(PASEO_CONTEXT_OPEN)).toBe(true);
    expect(first.params.prompt[1]).toEqual({ type: "text", text: "hi" });

    const second = await proxy.fromClient(prompt(3, "s1"));
    expect(second).toBe(prompt(3, "s1"));
    expect(loads()).toBe(1);
  });

  it("does not inject into sessions it did not create", async () => {
    const { proxy } = createProxy();
    expect(await proxy.fromClient(prompt(2, "loaded"))).toBe(prompt(2, "loaded"));
  });

  it("forwards prompts unchanged when there is no context", async () => {
    const { proxy } = createProxy("");
    await openSession(proxy, "s1", 1);
    expect(await proxy.fromClient(prompt(2, "s1"))).toBe(prompt(2, "s1"));
  });

  it("rewrites session/prompt usage to the turn usage", async () => {
    const { proxy } = createProxy();
    await proxy.fromClient(prompt("p1", "s1"));
    const response = JSON.parse(
      proxy.fromAgent(
        line({
          jsonrpc: "2.0",
          id: "p1",
          result: {
            stopReason: "end_turn",
            usage: { totalTokens: 500, inputTokens: 450, outputTokens: 50, cachedReadTokens: 0, cachedWriteTokens: 0 },
            _meta: { usage: { inputTokens: 40, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } },
          },
        }),
      ),
    );
    expect(response.result.usage).toMatchObject({ inputTokens: 40, outputTokens: 2, totalTokens: 42 });
  });

  it("does not confuse agent-initiated request ids with client request ids", async () => {
    const { proxy } = createProxy();
    await proxy.fromClient(prompt(1, "s1"));
    // Paseo answers the agent's permission request with id 1; that must not consume the prompt entry
    const permissionReply = line({ jsonrpc: "2.0", id: 1, result: { outcome: { outcome: "cancelled" } } });
    expect(await proxy.fromClient(permissionReply)).toBe(permissionReply);
    const response = JSON.parse(
      proxy.fromAgent(line({ jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn", usage: { inputTokens: 9, outputTokens: 9 } } })),
    );
    expect(response.result.usage.inputTokens).toBe(0);
  });

  it("keeps a mode option in configOptions so Paseo can still switch modes after config updates", async () => {
    const { proxy } = createProxy();
    const modes = {
      currentModeId: "default",
      availableModes: [
        { id: "default", name: "Standard" },
        { id: "plan", name: "Plan", description: "Research only" },
      ],
    };
    const model = { id: "model", name: "Model", category: "model", type: "select", currentValue: "m1", options: [] };

    await proxy.fromClient(line({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/w", mcpServers: [] } }));
    const created = JSON.parse(proxy.fromAgent(line({ jsonrpc: "2.0", id: 1, result: { sessionId: "s1", modes, configOptions: [model] } })));
    expect(created.result.configOptions[1]).toMatchObject({ category: "mode", currentValue: "default" });
    expect(created.result.configOptions[1].options).toEqual([
      { value: "default", name: "Standard" },
      { value: "plan", name: "Plan", description: "Research only" },
    ]);

    await proxy.fromClient(line({ jsonrpc: "2.0", id: 2, method: "session/set_mode", params: { sessionId: "s1", modeId: "plan" } }));
    proxy.fromAgent(line({ jsonrpc: "2.0", id: 2, result: {} }));
    const update = JSON.parse(
      proxy.fromAgent(
        line({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "s1", update: { sessionUpdate: "config_option_update", configOptions: [model] } },
        }),
      ),
    );
    expect(update.params.update.configOptions[1]).toMatchObject({ category: "mode", currentValue: "plan" });

    proxy.fromAgent(
      line({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "s1", update: { sessionUpdate: "current_mode_update", currentModeId: "default" } },
      }),
    );
    await proxy.fromClient(
      line({ jsonrpc: "2.0", id: 3, method: "session/set_config_option", params: { sessionId: "s1", configId: "model", value: "m1" } }),
    );
    const setOption = JSON.parse(proxy.fromAgent(line({ jsonrpc: "2.0", id: 3, result: { configOptions: [model] } })));
    expect(setOption.result.configOptions[1]).toMatchObject({ category: "mode", currentValue: "default" });
  });

  it("passes through lines it cannot parse", async () => {
    const { proxy } = createProxy();
    expect(proxy.fromAgent("not json")).toBe("not json");
    expect(await proxy.fromClient("not json")).toBe("not json");
  });
});

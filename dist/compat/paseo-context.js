import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRecord } from "../json-rpc.js";
export const PASEO_CONTEXT_OPEN = "<paseo-system-context>";
export const PASEO_CONTEXT_CLOSE = "</paseo-system-context>";
const PASEO_CONTEXT_HEADER = "The user's Paseo agent orchestrator launched this session over ACP, which has no system prompt channel. " +
    "The following is the system prompt the user configured in Paseo for this agent; follow it as system instructions for the whole session.";
const AGENT_STATE_SEARCH_DEPTH = 4;
const AGENT_STATE_RETRY_ATTEMPTS = 25;
const AGENT_STATE_RETRY_DELAY_MS = 20;
const MAX_CONTEXT_CHARS = 200_000;
export function resolvePaseoHome(env) {
    const configured = env.PASEO_HOME?.trim();
    if (configured) {
        if (configured === "~")
            return os.homedir();
        if (configured.startsWith("~/"))
            return path.join(os.homedir(), configured.slice(2));
        return configured;
    }
    return path.join(env.HOME || os.homedir(), ".paseo");
}
async function findFile(dir, fileName, depth) {
    if (depth < 0)
        return undefined;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        if (entry.isFile() && entry.name === fileName)
            return path.join(dir, entry.name);
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const found = await findFile(path.join(dir, entry.name), fileName, depth - 1);
        if (found)
            return found;
    }
    return undefined;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function readPromptParts(metadata) {
    return [metadata.systemPrompt, metadata.daemonAppendSystemPrompt]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .map((part) => part.trim())
        .join("\n\n")
        .slice(0, MAX_CONTEXT_CHARS);
}
/**
 * Paseo は ACP プロバイダへエージェントの systemPrompt と daemon の appendSystemPrompt を渡さない。
 * セッション設定は `$PASEO_HOME/agents/<project>/<PASEO_AGENT_ID>.json` の
 * persistence.metadata に保存されるので、そこから読み出す。
 */
export async function readPaseoSystemContext(env) {
    const agentId = env.PASEO_AGENT_ID;
    if (!agentId || agentId.includes("/") || agentId.includes("\\"))
        return "";
    const agentsDir = path.join(resolvePaseoHome(env), "agents");
    for (let attempt = 0; attempt < AGENT_STATE_RETRY_ATTEMPTS; attempt++) {
        try {
            const statePath = await findFile(agentsDir, `${agentId}.json`, AGENT_STATE_SEARCH_DEPTH);
            if (statePath) {
                const state = JSON.parse(await readFile(statePath, "utf8"));
                const metadata = isRecord(state) && isRecord(state.persistence) && isRecord(state.persistence.metadata)
                    ? state.persistence.metadata
                    : null;
                return metadata ? readPromptParts(metadata) : "";
            }
        }
        catch {
            // Paseo が書き込み中の可能性があるので少し待って読み直す
        }
        if (attempt < AGENT_STATE_RETRY_ATTEMPTS - 1) {
            await delay(AGENT_STATE_RETRY_DELAY_MS);
        }
    }
    return "";
}
/** session/prompt の先頭にシステムコンテキストのテキストブロックを差し込む。 */
export function prependContext(params, context) {
    if (!context || !isRecord(params) || !Array.isArray(params.prompt))
        return params;
    const block = {
        type: "text",
        text: [PASEO_CONTEXT_OPEN, PASEO_CONTEXT_HEADER, "", context, PASEO_CONTEXT_CLOSE].join("\n"),
    };
    return { ...params, prompt: [block, ...params.prompt] };
}
const CONTEXT_BLOCK = new RegExp(`^\\s*${escapeRegExp(PASEO_CONTEXT_OPEN)}[\\s\\S]*?${escapeRegExp(PASEO_CONTEXT_CLOSE)}\\s*`);
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** session/load の履歴再生で返ってくるユーザーメッセージから注入したコンテキストを取り除く。 */
export function stripContextFromUserChunk(update) {
    const content = update.content;
    if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string")
        return update;
    if (!CONTEXT_BLOCK.test(content.text))
        return update;
    return { ...update, content: { ...content, text: content.text.replace(CONTEXT_BLOCK, "") } };
}

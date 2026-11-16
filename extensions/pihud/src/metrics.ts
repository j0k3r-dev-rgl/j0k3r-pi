import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Same source and scope as Pi's footer: assistant usage on the active branch.
export function readMetrics(ctx: ExtensionContext) {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0, cost = 0;
  let turns = 0, toolCalls = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "user") turns++;
    if (entry.message.role !== "assistant") continue;
    const message = entry.message;
    input += message.usage?.input ?? 0;
    output += message.usage?.output ?? 0;
    cacheRead += message.usage?.cacheRead ?? 0;
    cacheWrite += message.usage?.cacheWrite ?? 0;
    reasoning += message.usage?.reasoning ?? 0;
    cost += message.usage?.cost?.total ?? 0;
    toolCalls += message.content?.filter((part) => part.type === "toolCall").length ?? 0;
  }
  const usage = ctx.getContextUsage();
  return {
    input, output, cacheRead, cacheWrite, reasoning, cost, turns, toolCalls,
    context: usage?.tokens ?? null,
    contextKnown: usage?.tokens != null,
    percent: usage?.percent ?? null,
    limit: usage?.contextWindow ?? ctx.model?.contextWindow,
  };
}

export function parseTokenSpeed(status: unknown): number | null {
  if (typeof status !== "string") return null;
  const plain = status.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const match = plain.match(/(\d+(?:\.\d+)?)\s+tok\/s\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

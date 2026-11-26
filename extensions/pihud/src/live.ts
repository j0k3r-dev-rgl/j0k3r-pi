import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { statePath } from "./controller.ts";

export type LiveState = "working" | "waiting" | "idle" | "";

export type LiveEvent = {
  seq: number;
  at: string;
  kind: string;
  label: string;
  detail: string;
  state: LiveState;
};

export type LiveSnapshot = {
  sessionPath: string;
  sessionId?: string;
  panels?: import('./panels.ts').Panels;
  cwd: string;
  model: string;
  provider: string;
  thinking: string;
  context?: number | null;
  contextKnown?: boolean;
  percent?: number | null;
  limit?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  cost?: number;
  turns?: number;
  toolCalls?: number;
  tps?: number | null;
  tpsSource?: "pi" | "response";
};

export function livePath(pane: string, socket: string, root?: string): string {
  return statePath(pane, socket, root).replace(/\.json$/, ".live.json");
}

export function clean(value: unknown, limit = 160): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function summarizeArgs(tool: string, args: unknown): string {
  const input = (args ?? {}) as Record<string, unknown>;
  const keys = ["command", "path", "file_path", "pattern", "query", "url", "description"];
  for (const key of keys) {
    if (typeof input[key] === "string" && input[key]) return clean(input[key]);
  }
  try {
    return clean(JSON.stringify(input));
  } catch {
    return "";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  return value;
}

export function livePayloadKey(
  kind: string,
  label: string,
  detail = "",
  state: LiveState = "working",
  snapshot?: LiveSnapshot,
): string {
  return JSON.stringify(canonicalize({
    ...snapshot,
    kind,
    label: clean(label, 60),
    detail: clean(detail),
    state,
  }));
}

export function createLiveWriter(options: { pane: string; socket: string; root?: string; now?: () => Date }) {
  const file = livePath(options.pane, options.socket, options.root);
  const now = options.now ?? (() => new Date());
  let seq = 0;
  let chain: Promise<void> = Promise.resolve();

  function write(event: LiveEvent): Promise<void> {
    chain = chain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, `${JSON.stringify(event)}\n`, { mode: 0o600 });
        await rename(temp, file);
      });
    return chain;
  }

  return {
    path: file,
    push(kind: string, label: string, detail = "", state: LiveState = "working", snapshot?: LiveSnapshot): Promise<void> {
      seq += 1;
      return write({
        ...snapshot,
        seq,
        at: now().toISOString(),
        kind,
        label: clean(label, 60),
        detail: clean(detail),
        state,
      });
    },
    async flush(): Promise<void> {
      await chain.catch(() => undefined);
    },
  };
}

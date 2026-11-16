import net from "node:net";
import { type Connect, type SocketLike, endpoint, lines, sendOnce } from "./herdr.ts";

export type GuardOptions = {
  piPane: string;
  hudPane: string;
  socket: string;
  connect?: Connect;
  onError?: (error: unknown) => void;
  now?: () => number;
  retryMinMs?: number;
  retryMaxMs?: number;
  dedupeMs?: number;
};

export type FocusGuard = {
  start(): void;
  stop(): void;
  readonly active: boolean;
  readonly corrections: number;
};

const RETRY_MIN_MS = 250;
const RETRY_MAX_MS = 3000;
const RESUBSCRIBE_MS = 1000;
const DEDUPE_MS = 50;
export function createFocusGuard(options: GuardOptions): FocusGuard {
  const connect = options.connect ?? ((path: string) => net.createConnection(path) as SocketLike);
  const now = options.now ?? Date.now;
  const retryMin = options.retryMinMs ?? RETRY_MIN_MS;
  const retryMax = options.retryMaxMs ?? RETRY_MAX_MS;
  const dedupe = options.dedupeMs ?? DEDUPE_MS;
  const target = endpoint(options.socket);
  let socket: SocketLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let attempt = 0;
  let lastCorrection = 0;
  let corrections = 0;
  let active = false;

  function report(error: unknown) {
    options.onError?.(error);
  }

  function schedule(delay: number) {
    if (!running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(dial, delay);
    timer.unref?.();
  }

  function focusPi() {
    const at = now();
    if (at - lastCorrection < dedupe) return;
    lastCorrection = at;
    corrections += 1;
    void sendOnce(connect, options.socket, {
      id: `pihud:focus:${at}:${corrections}`,
      method: "pane.focus",
      params: { pane_id: options.piPane },
    }).catch(report);
  }

  function onLine(line: string) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.result?.type === "subscription_started") {
      active = true;
      attempt = 0;
      return;
    }
    if (message?.error?.code === "events_lost") {
      active = false;
      socket?.destroy();
      schedule(RESUBSCRIBE_MS);
      return;
    }
    if (message?.event === "pane_focused" && message?.data?.pane_id === options.hudPane) {
      focusPi();
    }
  }

  function dial() {
    if (!running) return;
    const connection = connect(target);
    socket = connection;
    active = false;
    const onData = lines(onLine);
    connection.on("data", (chunk: Buffer | string) => onData(chunk));
    connection.on("error", (error: unknown) => {
      report(error);
      if (socket === connection) socket = undefined;
      active = false;
      schedule(Math.min(retryMax, retryMin * 2 ** attempt++));
    });
    connection.on("close", () => {
      if (socket === connection) socket = undefined;
      active = false;
      if (running) schedule(Math.min(retryMax, retryMin * 2 ** attempt++));
    });
    connection.on("connect", () => {
      connection.write(
        `${JSON.stringify({
          id: `pihud:sub:${options.hudPane}`,
          method: "events.subscribe",
          params: { subscriptions: [{ type: "pane.focused", pane_id: options.hudPane }] },
        })}\n`,
      );
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      dial();
    },
    stop() {
      running = false;
      active = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      socket?.destroy();
      socket = undefined;
    },
    get active() {
      return active;
    },
    get corrections() {
      return corrections;
    },
  };
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Exec = (args: string[], signal?: AbortSignal) => Promise<any>;

export type HudState = {
  piPane: string;
  hudPane: string;
  terminalId: string;
  visible: boolean;
};

export type ControllerOptions = {
  pane: string;
  socket: string;
  bin: string;
  ratio?: string;
  file?: string;
  root?: string;
  exec: Exec;
};

export function cacheRoot(env = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "j0k3r-pihud");
}

export function statePath(pane: string, socket: string, root = cacheRoot()): string {
  const key = createHash("sha256").update(`${socket}\0${pane}`).digest("hex");
  return join(root, `${key}.json`);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function parseRatio(value: string | undefined): number {
  const ratio = Number(value ?? "0.80");
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    throw new Error(`PIHUD_RATIO inválido: ${value ?? ""} (esperado 0 < ratio < 1)`);
  }
  return ratio;
}

type PaneInfo = { pane_id: string; terminal_id: string };

export function createController(options: ControllerOptions) {
  const file = options.file ?? statePath(options.pane, options.socket, options.root);
  const ratio = () => parseRatio(options.ratio);
  let opening: Promise<"opened" | "already-open"> | undefined;

  async function readState(): Promise<HudState | undefined> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<HudState>;
      if (typeof parsed.hudPane !== "string" || typeof parsed.visible !== "boolean") return undefined;
      return {
        piPane: options.pane,
        hudPane: parsed.hudPane,
        terminalId: typeof parsed.terminalId === "string" ? parsed.terminalId : "",
        visible: parsed.visible,
      };
    } catch (error: any) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async function writeState(state: HudState): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temp, file);
  }

  async function panes(signal?: AbortSignal): Promise<Map<string, PaneInfo>> {
    const response = await options.exec(["api", "snapshot"], signal);
    const list = response?.result?.snapshot?.panes ?? [];
    return new Map(list.map((pane: PaneInfo) => [pane.pane_id, pane]));
  }

  async function closeOwnedHud(state: HudState, signal?: AbortSignal): Promise<void> {
    await options.exec(["pane", "close", state.hudPane], signal);
  }

  async function open(cwd: string, signal?: AbortSignal): Promise<"opened" | "already-open"> {
    if (opening) return opening;
    opening = (async () => {
      const current = await readState();
      if (current?.hudPane) {
        const live = await panes(signal);
        const entry = live.get(current.hudPane);
        if (entry && entry.terminal_id === current.terminalId && current.hudPane !== options.pane) {
          await writeState({ ...current, visible: true });
          return "already-open";
        }
      }
      const next: HudState = { piPane: options.pane, hudPane: "", terminalId: "", visible: true };
      const split = await options.exec(
        [
          "pane",
          "split",
          options.pane,
          "--direction",
          "right",
          "--ratio",
          String(ratio()),
          "--cwd",
          cwd,
          "--no-focus",
          "--right-click",
          "pane",
        ],
        signal,
      );
      const hudPane = split?.result?.pane?.pane_id;
      const terminalId = split?.result?.pane?.terminal_id;
      if (typeof hudPane !== "string" || hudPane.length === 0) {
        throw new Error("herdr no devolvió el panel del HUD");
      }
      // Respect zsh HIST_IGNORE_SPACE / bash HISTCONTROL=ignorespace.
      const command = ` exec ${shellQuote(options.bin)} --pane ${shellQuote(options.pane)} --cwd ${shellQuote(cwd)}`;
      try {
        await options.exec(["pane", "run", hudPane, command], signal);
      } catch (error) {
        await options.exec(["pane", "close", hudPane]).catch(() => undefined);
        throw error;
      }
      await writeState({ ...next, hudPane, terminalId: String(terminalId ?? "") });
      return "opened";
    })().finally(() => {
      opening = undefined;
    });
    return opening;
  }

  async function close(signal?: AbortSignal): Promise<"closed" | "already-closed"> {
    const current = await readState();
    if (!current) {
      await writeState({ piPane: options.pane, hudPane: "", terminalId: "", visible: false });
      return "already-closed";
    }
    if (!current.hudPane) {
      if (current.visible) await writeState({ ...current, visible: false });
      return "already-closed";
    }
    const live = await panes(signal);
    const entry = live.get(current.hudPane);
    if (!entry || entry.terminal_id !== current.terminalId || current.hudPane === options.pane) {
      await writeState({ ...current, hudPane: "", terminalId: "", visible: false });
      return "already-closed";
    }
    await closeOwnedHud(current, signal);
    await writeState({ ...current, hudPane: "", terminalId: "", visible: false });
    return "closed";
  }

  async function status(): Promise<HudState | undefined> {
    return readState();
  }

  async function isOpen(): Promise<boolean> {
    const current = await readState();
    if (!current?.hudPane || current.hudPane === options.pane) return false;
    const live = await panes();
    return live.get(current.hudPane)?.terminal_id === current.terminalId;
  }

  return { open, close, status, isOpen, file };
}

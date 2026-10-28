import { spawn, type ChildProcess } from "node:child_process";

export class AudioPlayer {
  private currentPlayback: { process: ChildProcess; stopped: boolean; paused: boolean } | null = null;

  /**
   * Reproduce un buffer de audio en segundo plano sin bloquear la terminal.
   * Permite acelerar la reproducción con atempo (0.5x a 3.0x) sin alterar el tono.
   * Si ya hay una reproducción activa, la detiene antes de comenzar la nueva.
   */
  async play(audioBuffer: Buffer, speed: number = 1.0): Promise<void> {
    return this.playInput((async function* () { yield audioBuffer; })(), speed, false);
  }

  async playStream(chunks: AsyncIterable<Buffer>, speed: number = 1.0): Promise<void> {
    return this.playInput(chunks, speed, true);
  }

  private async playInput(chunks: AsyncIterable<Buffer>, speed: number, pcm: boolean): Promise<void> {
    this.stop();

    return new Promise<void>((resolve, reject) => {
      try {
        const args = ["-nodisp", "-autoexit", "-loglevel", "quiet"];

        if (speed && speed !== 1.0) {
          const clamped = Math.max(0.5, Math.min(speed, 3.0));
          if (clamped <= 2.0) {
            args.push("-af", `atempo=${clamped.toFixed(2)}`);
          } else {
            args.push("-af", `atempo=2.0,atempo=${(clamped / 2.0).toFixed(2)}`);
          }
        }

        if (pcm) args.push("-f", "s16le", "-sample_rate", "24000", "-ch_layout", "mono");
        args.push("-i", "pipe:0");

        const proc = spawn("ffplay", args, {
          stdio: ["pipe", "ignore", "ignore"],
          detached: false,
        });

        const playback = { process: proc, stopped: false, paused: false };
        this.currentPlayback = playback;
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (this.currentPlayback === playback) this.currentPlayback = null;
          if (error && !playback.stopped) reject(error);
          else resolve();
        };
        const fail = (error: Error) => {
          finish(error);
          // A failed pipe may leave the player alive. Keep error listeners until
          // it closes: late stream errors must never become uncaught exceptions.
          proc.stdin.destroy();
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill("SIGTERM");
            if (playback.paused) proc.kill("SIGCONT");
          }
        };

        // Stream errors (notably EPIPE) are separate from ChildProcess errors.
        // Both listeners must be installed before writing any audio.
        proc.stdin.on("error", fail);
        proc.on("error", fail);
        proc.on("close", (code, signal) => {
          finish(code === 0 ? undefined : new Error(`ffplay terminó con ${signal ?? `código ${code}`}.`));
        });

        void (async () => {
          try {
            for await (const chunk of chunks) {
              if (playback.stopped || settled) break;
              if (!proc.stdin.write(chunk)) await new Promise<void>((resolve, reject) => {
                const cleanup = () => { proc.stdin.off("drain", drained); proc.stdin.off("error", failed); proc.stdin.off("close", closed); };
                const drained = () => { cleanup(); resolve(); };
                const failed = (error: Error) => { cleanup(); reject(error); };
                const closed = () => { cleanup(); reject(new Error("La tubería de audio se cerró.")); };
                proc.stdin.once("drain", drained); proc.stdin.once("error", failed); proc.stdin.once("close", closed);
              });
            }
            if (!playback.stopped && !settled) proc.stdin.end();
          } catch (error) { fail(error instanceof Error ? error : new Error("No se pudo enviar el audio a ffplay.")); }
        })();
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Pausa el proceso sin reiniciarlo ni perder su posición (Linux/macOS). */
  pause(): boolean {
    const playback = this.currentPlayback;
    if (!playback || playback.paused) return false;
    try {
      if (!playback.process.kill("SIGSTOP")) return false;
      playback.paused = true;
      return true;
    } catch { return false; }
  }

  resume(): boolean {
    const playback = this.currentPlayback;
    if (!playback || !playback.paused) return false;
    try {
      if (!playback.process.kill("SIGCONT")) return false;
      playback.paused = false;
      return true;
    } catch { return false; }
  }

  isPaused(): boolean { return this.currentPlayback?.paused ?? false; }

  /**
   * Detiene inmediatamente cualquier reproducción de audio en curso.
   */
  stop(): void {
    const playback = this.currentPlayback;
    if (!playback) return;
    this.currentPlayback = null;
    playback.stopped = true;
    playback.process.stdin?.destroy();
    try {
      playback.process.kill("SIGTERM");
      // A suspended process cannot handle SIGTERM until it runs again.
      if (playback.paused) playback.process.kill("SIGCONT");
    } catch {
      // Ignorar si el proceso ya terminó
    }
  }

  /**
   * Indica si hay audio reproduciéndose actualmente.
   */
  isPlaying(): boolean {
    return this.currentPlayback !== null;
  }
}

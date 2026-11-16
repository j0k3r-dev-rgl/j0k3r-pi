import net from "node:net";

export type SocketLike = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  write(data: string): unknown;
  destroy(): void;
};

export type Connect = (path: string) => SocketLike;

export const defaultConnect: Connect = (path) => net.createConnection(path);

export function endpoint(socket: string): string {
  return process.platform === "win32" ? `\\\\.\\pipe\\${socket}` : socket;
}

export function lines(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString();
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) onLine(line);
      index = buffer.indexOf("\n");
    }
  };
}

export function sendOnce(connect: Connect, socket: string, request: unknown, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const target = endpoint(socket);
    const connection = connect(target);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.destroy();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    connection.on("error", finish);
    connection.on("close", finish);
    connection.on("data", finish);
    connection.on("connect", () => connection.write(`${JSON.stringify(request)}\n`));
  });
}

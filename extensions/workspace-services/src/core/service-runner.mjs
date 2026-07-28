import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';

const HANDOFF_FD = 3;
const MAX_PAYLOAD_BYTES = 256 * 1024;

function redactText(text, secrets) {
  let output = text;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

async function loadPayload() {
  const stream = createReadStream(null, { fd: HANDOFF_FD, encoding: 'utf8', autoClose: true });
  let raw = '';
  for await (const chunk of stream) {
    raw += chunk;
    if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new Error(`Runner payload exceeded ${MAX_PAYLOAD_BYTES} bytes`);
    }
  }
  if (!raw) throw new Error('Missing runner payload');
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object') throw new Error('Invalid runner payload');
  if (typeof payload.cwd !== 'string' || typeof payload.command !== 'string' || typeof payload.logPath !== 'string') {
    throw new Error('Invalid runner payload');
  }
  if (!payload.env || typeof payload.env !== 'object' || Array.isArray(payload.env)) throw new Error('Invalid runner payload');
  if (!Array.isArray(payload.secrets) || payload.secrets.some((value) => typeof value !== 'string')) throw new Error('Invalid runner payload');
  return payload;
}

async function groupMembers(pgid, sid, leaderStart) {
  const matches = [];
  for (const name of await readdir('/proc')) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      const statText = await readFile(`/proc/${pid}/stat`, 'utf8');
      const idx = statText.lastIndexOf(') ');
      const fields = statText.slice(idx + 2).trim().split(/\s+/);
      const currentPgid = Number(fields[2]);
      const currentSid = Number(fields[3]);
      const startTicks = fields[19];
      if (currentPgid !== pgid || currentSid !== sid) continue;
      if (leaderStart && pid !== process.pid && BigInt(startTicks) < BigInt(leaderStart)) continue;
      matches.push(pid);
    } catch {
      // ignore races
    }
  }
  return matches;
}

const payload = await loadPayload();
const logStream = createWriteStream(payload.logPath, { flags: 'a', mode: 0o600 });
const child = spawn(payload.command, {
  cwd: payload.cwd,
  env: { ...process.env, ...payload.env },
  shell: true,
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const writeChunk = (chunk) => {
  logStream.write(redactText(String(chunk), payload.secrets));
};
child.stdout?.on('data', writeChunk);
child.stderr?.on('data', writeChunk);

let shuttingDown = false;
const terminateGroup = (signal) => {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      process.kill(child.pid, signal);
    } catch {
      // ignore
    }
  }
};

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminateGroup(signal);
  });
}

const waitForEmpty = async () => {
  if (!child.pid) return;
  const leaderStart = await readFile(`/proc/${child.pid}/stat`, 'utf8').then((text) => text.slice(text.lastIndexOf(') ') + 2).trim().split(/\s+/)[19]).catch(() => undefined);
  for (;;) {
    const members = await groupMembers(child.pid, child.pid, leaderStart);
    if (members.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

child.on('close', async () => {
  await waitForEmpty().catch(() => undefined);
  await new Promise((resolve) => logStream.end(resolve));
  process.exit(0);
});

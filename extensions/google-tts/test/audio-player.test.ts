import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Run each failure in its own Node process: an unhandled stream error must fail
// the test without bringing down the test runner. No ffplay, sound or network.
function isolated(body: string) {
  const script = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { once } from 'node:events';
    const originalSpawn = childProcess.spawn;
    const children = [];
    function fakePlayer(code) {
      childProcess.spawn = () => {
        const child = originalSpawn(process.execPath, ['-e', code], {
          stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
        });
        children.push(child);
        return child;
      };
      syncBuiltinESMExports();
    }
    const { AudioPlayer } = await import(${JSON.stringify(new URL("../src/audio-player.ts", import.meta.url).href)});
    const player = new AudioPlayer();
    const outcome = promise => promise.then(() => ({ ok: true }), error => ({ ok: false, error }));
    try {
      ${body}
    } finally {
      player.stop();
      for (const child of children) child.kill();
    }
    console.log('PLAYBACK_CHECK_PASSED');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PLAYBACK_CHECK_PASSED/);
}

test("early player exit rejects instead of crashing Node with unhandled EPIPE", () => {
  isolated(`
    fakePlayer('process.exit(1)');
    const result = await outcome(player.play(Buffer.alloc(8 * 1024 * 1024)));
    assert.equal(result.ok, false);
    assert.equal(player.isPlaying(), false);
  `);
});

test("broken input pipe terminates the failed player without crashing Node", () => {
  isolated(`
    fakePlayer("require('node:fs').closeSync(0); setInterval(() => {}, 1000)");
    const pending = outcome(player.play(Buffer.alloc(8 * 1024 * 1024)));
    const closed = once(children[0], 'close');
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(player.isPlaying(), false);
    await closed;
    assert.equal(children[0].signalCode, 'SIGTERM');
  `);
});

test("missing player reports spawn failure and handles its stdin failure", () => {
  isolated(`
    childProcess.spawn = () => originalSpawn('/__pi_tts_missing_executable__', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    syncBuiltinESMExports();
    const result = await outcome(player.play(Buffer.alloc(1024 * 1024)));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ENOENT');
    assert.equal(player.isPlaying(), false);
  `);
});

test("nonzero exit after reading audio is a playback error", () => {
  isolated(`
    fakePlayer("process.stdin.resume(); process.stdin.on('end', () => process.exit(7))");
    const result = await outcome(player.play(Buffer.from('audio')));
    assert.equal(result.ok, false);
    assert.match(result.error.message, /7/);
    assert.equal(player.isPlaying(), false);
  `);
});

test("unexpected signal is a playback error", () => {
  isolated(`
    fakePlayer("process.stdin.resume(); process.stdin.on('end', () => process.kill(process.pid, 'SIGTERM'))");
    const result = await outcome(player.play(Buffer.from('audio')));
    assert.equal(result.ok, false);
    assert.match(result.error.message, /SIGTERM/);
  `);
});

test("successful playback resolves and clears playing state", () => {
  isolated(`
    fakePlayer("process.stdin.resume(); process.stdin.on('end', () => process.exit(0))");
    const pending = outcome(player.play(Buffer.from('audio'), 1.18));
    assert.equal(player.isPlaying(), true);
    assert.equal((await pending).ok, true);
    assert.equal(player.isPlaying(), false);
  `);
});

test("intentional stop while writing is safe, resolves, and is idempotent", () => {
  isolated(`
    fakePlayer("process.send('ready'); setInterval(() => {}, 1000)");
    const pending = outcome(player.play(Buffer.alloc(8 * 1024 * 1024)));
    await once(children[0], 'message');
    player.stop();
    player.stop();
    assert.equal(player.isPlaying(), false);
    assert.equal((await pending).ok, true);
  `);
});

test("pause and resume keep the same player and stop can terminate a paused child", () => {
  isolated(`
    fakePlayer("process.send('ready'); setInterval(() => {}, 1000)");
    const pending = outcome(player.play(Buffer.alloc(8 * 1024 * 1024)));
    await once(children[0], 'message');
    const signals = [];
    const child = children[0];
    const kill = child.kill.bind(child);
    child.kill = signal => { signals.push(signal); return kill(signal); };
    assert.equal(player.pause(), true);
    assert.equal(player.isPaused(), true);
    assert.equal(player.pause(), false);
    assert.equal(player.resume(), true);
    assert.equal(player.isPaused(), false);
    assert.equal(player.resume(), false);
    assert.deepEqual(signals, ['SIGSTOP', 'SIGCONT']);
    assert.equal(children.length, 1);
    assert.equal(player.pause(), true);
    player.stop();
    assert.equal((await pending).ok, true);
    assert.equal(player.isPlaying(), false);
    assert.equal(player.isPaused(), false);
    assert.deepEqual(signals.slice(-2), ['SIGTERM', 'SIGCONT']);
    assert.equal(player.pause(), false);
    assert.equal(player.resume(), false);
  `);
});

test("failed pause or resume leaves the player state unchanged", () => {
  isolated(`
    fakePlayer("process.send('ready'); setInterval(() => {}, 1000)");
    const pending = outcome(player.play(Buffer.from('audio')));
    await once(children[0], 'message');
    const child = children[0];
    const kill = child.kill.bind(child);
    child.kill = () => false;
    assert.equal(player.pause(), false);
    assert.equal(player.isPaused(), false);
    child.kill = kill;
    assert.equal(player.pause(), true);
    child.kill = () => { throw new Error('signal failed'); };
    assert.equal(player.resume(), false);
    assert.equal(player.isPaused(), true);
    child.kill = kill;
    player.stop();
    assert.equal((await pending).ok, true);
  `);
});

test("streaming player consumes chunks incrementally with PCM arguments", () => {
  isolated(`
    let passedArgs;
    childProcess.spawn = (_command, args) => {
      passedArgs = args;
      const child = originalSpawn(process.execPath, ['-e', "process.stdin.on('data', () => process.send('chunk')); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"], { stdio: ['pipe', 'ignore', 'ignore', 'ipc'] });
      children.push(child); return child;
    };
    syncBuiltinESMExports();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const chunks = (async function* () { yield Buffer.from([1, 2]); await gate; yield Buffer.from([3, 4]); })();
    const pending = outcome(player.playStream(chunks, 1));
    await once(children[0], 'message');
    assert.ok(passedArgs.includes('s16le'));
    assert.deepEqual(passedArgs.slice(passedArgs.indexOf('-f'), passedArgs.indexOf('-i')), ['-f', 's16le', '-sample_rate', '24000', '-ch_layout', 'mono']);
    release();
    assert.equal((await pending).ok, true);
  `);
});

test("selected output sets PulseAudio only for ffplay for both streaming and replay", () => {
  isolated(`
    const calls = [];
    childProcess.spawn = (command, args, options) => {
      calls.push({ command, args, options });
      const child = originalSpawn(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"], { stdio: ['pipe', 'ignore', 'ignore', 'ipc'] });
      children.push(child); return child;
    };
    syncBuiltinESMExports();
    const pulseBefore = process.env.PULSE_SERVER;
    const driverBefore = process.env.SDL_AUDIODRIVER;
    await player.play(Buffer.from('audio'), 1, 14713);
    await player.playStream((async function* () { yield Buffer.from([1, 2]); })(), 1, 14714);
    await player.play(Buffer.from('default'), 1);
    assert.equal(calls[0].command, 'ffplay');
    assert.equal(calls[0].options.env.PULSE_SERVER, 'tcp:127.0.0.1:14713');
    assert.equal(calls[1].options.env.PULSE_SERVER, 'tcp:127.0.0.1:14714');
    assert.equal(calls[0].options.env.SDL_AUDIODRIVER, 'pulseaudio');
    assert.equal(calls[2].options.env, undefined, 'default must inherit the process environment unchanged');
    assert.equal(process.env.PULSE_SERVER === pulseBefore, true, 'parent PulseAudio setting is unchanged');
    assert.equal(process.env.SDL_AUDIODRIVER === driverBefore, true, 'parent SDL setting is unchanged');
  `);
});

test("old player shutdown does not clear the replacement playback", () => {
  isolated(`
    fakePlayer("process.send('ready'); setInterval(() => {}, 1000)");
    const first = outcome(player.play(Buffer.alloc(8 * 1024 * 1024)));
    await once(children[0], 'message');
    const second = outcome(player.play(Buffer.from('second')));
    await once(children[1], 'message');
    assert.equal((await first).ok, true);
    assert.equal(player.isPlaying(), true);
    player.stop();
    assert.equal((await second).ok, true);
  `);
});

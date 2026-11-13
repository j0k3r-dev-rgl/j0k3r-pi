import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSubagents } from '../src/subagent-discovery.ts';

test('DISCOVERY-001: discovers global and project subagent markdown names with project override precedence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sup-discovery-'));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    const agentDir = join(dir, 'agent');
    const cwd = join(dir, 'project');
    process.env.PI_CODING_AGENT_DIR = agentDir;

    mkdirSync(join(agentDir, 'agents'), { recursive: true });
    mkdirSync(join(agentDir, 'subagents'), { recursive: true });
    mkdirSync(join(cwd, '.pi', 'agents'), { recursive: true });
    mkdirSync(join(cwd, '.pi', 'subagents'), { recursive: true });

    writeFileSync(join(agentDir, 'agents', 'alpha.md'), '---\nname: Alpha\n---\nGlobal agent');
    writeFileSync(join(agentDir, 'subagents', '00-discovery.md'), '---\nname: 00-discovery\n---\nDiscovery');
    writeFileSync(join(agentDir, 'subagents', 'shared.md'), '---\nname: Shared\n---\nGlobal');
    writeFileSync(join(cwd, '.pi', 'subagents', 'shared.md'), '---\nname: shared\n---\nProject override');
    writeFileSync(join(cwd, '.pi', 'agents', 'custom.md'), 'No frontmatter name uses filename');

    const discovered = discoverSubagents(cwd);
    assert.deepEqual(
      discovered.map(d => [d.name, d.scope]),
      [
        ['00-discovery', 'global'],
        ['alpha', 'global'],
        ['custom', 'project'],
        ['shared', 'project'],
      ],
    );
  } finally {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

import { describe, it, expect, vi } from 'vitest';
import extension from '../../index.js';

describe('obsolete subagent-models command absence', () => {
  it('does not register subagent-models command', () => {
    const registeredCommands: string[] = [];
    const pi = {
      registerMessageRenderer: vi.fn(),
      registerTool: vi.fn(),
      on: vi.fn(),
      registerShortcut: vi.fn(),
      registerCommand: vi.fn((name: string) => {
        registeredCommands.push(name);
      }),
    };

    extension(pi);

    expect(registeredCommands).not.toContain('subagent-models');
    expect(registeredCommands).toContain('subagents');
  });
});

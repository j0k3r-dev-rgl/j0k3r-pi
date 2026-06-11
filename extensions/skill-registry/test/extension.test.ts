import { describe, expect, it, vi } from 'vitest';

import skillRegistryExtension from '../index.js';

describe('skill registry extension', () => {
  it('registers command and llm-callable tool', () => {
    const tools: any[] = [];
    const commands: Record<string, any> = {};
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
      registerCommand: vi.fn((name: string, command: any) => { commands[name] = command; }),
    };

    skillRegistryExtension(pi);

    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'skill_registry_generate' }));
    expect(pi.registerCommand).toHaveBeenCalledWith('skill-registry', expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }));
    expect(tools[0]).toMatchObject({
      name: 'skill_registry_generate',
      label: 'Skill Registry Generate',
    });
    expect(commands['skill-registry']).toBeTruthy();
  });
});

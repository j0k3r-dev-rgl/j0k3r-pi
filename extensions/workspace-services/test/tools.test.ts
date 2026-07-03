import { describe, expect, it } from 'vitest';
import workspaceServicesExtension, { WORKSPACE_SERVICE_TOOL_NAMES } from '../index.js';

describe('workspace services extension entrypoint', () => {
  it('registers the expected separate tools', () => {
    const tools: Array<{ name: string }> = [];
    const pi = {
      registerTool(tool: { name: string }) {
        tools.push(tool);
      },
    };

    workspaceServicesExtension(pi);

    expect(tools.map((tool) => tool.name).sort()).toEqual([...WORKSPACE_SERVICE_TOOL_NAMES].sort());
  });
});

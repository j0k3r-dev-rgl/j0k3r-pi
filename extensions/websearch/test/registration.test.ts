import { describe, expect, it } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi } from './helpers.js';

describe('websearch tool registration', () => {
  it('registers only the two generic parent tools without excluded-provider tools', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi);

    expect(WEBSEARCH_TOOL_NAMES).toEqual([
      'discussion_search',
      'research_search',
    ]);
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    expect(pi.tools).toHaveLength(2);
    const excludedProviderPattern = new RegExp(`red${'dit'}`, 'i');
    expect(pi.tools.map((tool) => tool.name).join(' ')).not.toMatch(excludedProviderPattern);

    for (const tool of pi.tools) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });
});

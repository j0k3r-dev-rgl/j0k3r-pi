import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { createSubagentListAgentsTool } from '../../src/tools/subagent-list-agents.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_list_agents tool', () => {
  it('registers and lists agent-facing tools only', async () => {
    env.writeAgent('analyst');
    const registered: Record<string, any> = {};
    registerSubagentTools({ registerTool: (tool: any) => { registered[tool.name] = tool; } }, new SubagentManager(env.mockRunner() as any));

    expect(Object.keys(registered)).toEqual([
      'subagent_list_agents',
      'subagent_run',
      'subagent_status',
      'subagent_result',
      'subagent_list_tasks',
      'subagent_cancel',
      'subagent_send_message',
    ]);

    const result = await registered.subagent_list_agents.execute('1', {}, undefined, undefined, { cwd: env.tmp });
    expect(result.content[0].text).toContain('analyst · model: default/current · effort: default/current · tools:');
    expect(result.details.agents).toHaveLength(1);
    expect(result.details.agents[0]).toMatchObject({ name: 'analyst' });
  });

  it('lists the effective configured model and effort used for execution', () => {
    const agentDir = process.env.PI_CODING_AGENT_DIR!;
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: analyst agent\ntools: [read]\n---\n# Analyst\n`);
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      model_profiles: { analyst: { model: 'openai/gpt-5.4', effort: 'high' } },
    }));
    const manager = new SubagentManager(env.mockRunner() as any);

    expect(manager.listAgents(env.tmp, {})).toContainEqual(expect.objectContaining({
      name: 'analyst',
      model: { provider: 'openai', id: 'gpt-5.4' },
      effort: 'high',
    }));
  });

  it('shows five agents when collapsed and dim tools below every agent when expanded', async () => {
    const agents = Array.from({ length: 7 }, (_, index) => ({
      name: `agent-${index + 1}`,
      model: index === 0 ? { provider: 'openai', id: 'gpt-5.4' } : undefined,
      effort: index === 0 ? 'high' : undefined,
      tools: ['read', 'memory_search'],
    }));
    const tool = createSubagentListAgentsTool({ listAgents: () => agents } as any);
    const result = await tool.execute('1', {}, undefined, undefined, { cwd: env.tmp });
    const theme = { fg: (name: string, text: string) => name === 'dim' ? `<dim>${text}</dim>` : text };

    expect(result.content[0].text).toContain('agent-7 · model: default/current · effort: default/current · tools: read, memory_search');

    const collapsed = tool.renderResult(result, { expanded: false }, theme).render(200).join('\n');
    const expanded = tool.renderResult(result, { expanded: true }, theme).render(200).join('\n');

    expect(collapsed).toContain('agents: agent-1, agent-2, agent-3, agent-4, agent-5, … (7 total)');
    expect(collapsed).toContain('<dim>ctrl+o to expand</dim>');
    expect(collapsed).not.toContain('tools:');

    expect(expanded).toContain('agent-1 · model: openai/gpt-5.4 · effort: high');
    expect(expanded).toContain('agent-6 · model: default/current · effort: default/current');
    expect(expanded).toContain('agent-7 · model: default/current · effort: default/current');
    expect(expanded).toContain('<dim>  tools: read, memory_search</dim>');
    expect(expanded).not.toContain('ctrl+o to expand');
  });
});

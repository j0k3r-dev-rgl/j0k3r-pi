import type { ModelRef, ThinkingEffort } from '../types.js';
import { boxedComponent } from './components.js';
import { resolveExpandHint } from './expansion-hint.js';
import { ARCH_ICON, CYAN, themeDim, themeFg, themeTitle } from '../completion-message.js';

export type ListedSubagent = {
  name: string;
  model?: ModelRef;
  effort?: ThinkingEffort;
  tools: string[];
};

function modelLabel(model?: ModelRef): string {
  return model ? `${model.provider}/${model.id}` : 'default/current';
}

function summary(agent: ListedSubagent): string {
  return `${agent.name} · model: ${modelLabel(agent.model)} · effort: ${agent.effort ?? 'default/current'}`;
}

export function formatSubagentList(agents: ListedSubagent[], includeTools: boolean): string {
  if (!agents.length) return 'No subagents available.';
  return agents.map((agent) => (
    includeTools ? `${summary(agent)} · tools: ${agent.tools.join(', ') || 'none'}` : summary(agent)
  )).join('\n');
}

export function renderSubagentListResult(result: any, options: any, theme: any, context?: any) {
  const expanded = Boolean(typeof options === 'object' && options !== null ? options.expanded : options);
  const agents: ListedSubagent[] = Array.isArray(result?.details?.agents) ? result.details.agents : [];
  const archPrefix = themeFg(theme, 'accent', ARCH_ICON, CYAN);
  const title = `${archPrefix} ${themeTitle(theme, agents.length ? `subagents · ${agents.length} available` : 'subagents')}`;

  if (!agents.length) {
    return boxedComponent([themeDim(theme, 'No subagents available.')], {
      title,
      theme,
      wrapped: true,
    });
  }

  if (expanded) {
    const lines = agents.flatMap((agent) => [
      summary(agent),
      themeDim(theme, `  tools: ${agent.tools.join(', ') || 'none'}`),
    ]);
    return boxedComponent(lines, {
      title,
      theme,
      wrapped: true,
    });
  }

  const names = agents.map((a) => a.name);
  const sample = names.slice(0, 5).join(', ');
  const summaryLine = agents.length > 5
    ? `agents: ${sample}, … (${agents.length} total)`
    : `agents: ${sample}`;

  const lines = [
    summaryLine,
    themeDim(theme, resolveExpandHint('to expand', context)),
  ];

  return boxedComponent(lines, {
    title,
    theme,
    wrapped: true,
  });
}
